import type { Conversation } from '../types'
import * as scoped from './scopedStorage'
import { encrypt, decrypt, isCryptoReady } from './crypto'
import { deleteOwnedFiles } from './secureFileStorage'
import { getActiveUserId, getActiveSessionEpoch } from './userSession'

// ─────────────────────────────────────────────────────────────────────────
// Conversations are encrypted at rest (AES-256) under `conversations-enc`.
// The CRUD below stays SYNCHRONOUS (BUG 16 — making saveConversation async
// broke the UI) by serving reads from an in-memory decrypted cache, exactly
// like googleAuth.ts does for tokens (memTokens / bootstrapGoogleStorage).
//
// Write path: saveConversation updates the cache + writes a PLAIN copy
// synchronously (crash-safety net), then fires an async encrypt that writes
// the ciphertext and drops the plain net once it is confirmed. A plain copy
// present at boot is therefore always >= the ciphertext, and the bootstrap
// treats it as canonical.
//
// `arty-conv-encryption-disabled = '1'` is a killswitch: forces plain-only
// storage (pre-encryption behaviour) for a rollback without an APK release.
// It only gates the WRITE path — bootstrap still loads existing ciphertext,
// so flipping it never loses data.
// ─────────────────────────────────────────────────────────────────────────

const PLAIN_KEY = 'conversations'
const ENC_KEY = 'conversations-enc'
const KILLSWITCH_KEY = 'arty-conv-encryption-disabled'
// Quarantine slots for ciphertext the current key cannot decrypt. The blob is
// MOVED here (never deleted) so the app stays usable — cacheReady would
// otherwise stay false for the whole session and every new conversation would
// be silently dropped (blank-screen bug, juillet 2026). Each bootstrap retries
// these slots and merges the history back if the key situation heals.
const LOCKED_KEYS = ['conversations-enc-locked', 'conversations-enc-locked-2']

// Decrypted conversations, kept in memory for synchronous reads.
let memConversations: Conversation[] | null = null
// True once `memConversations` is known to reflect the full stored history
// (after a successful bootstrap, a cold plain read, or a confirmed-empty
// store). Writes are skipped while false so a partial list never overwrites
// the encrypted history.
let cacheReady = false
// Monotonic write counter — a background encrypt only drops the plain
// safety-net if no newer saveConversation has run since it started.
let writeGen = 0
let resetGen = 0
let bootstrapGen = 0
let cacheIdentity: { owner: string | null; epoch: number } | null = null
type StoreScope = { owner: string | null; epoch: number; reset: number }
function captureScope(): StoreScope {
  return { owner: getActiveUserId(), epoch: getActiveSessionEpoch(), reset: resetGen }
}
function scopeCurrent(scope: StoreScope): boolean {
  return scope.owner === getActiveUserId() && scope.epoch === getActiveSessionEpoch() && scope.reset === resetGen
}
function physicalKey(scope: StoreScope, key: string): string {
  return scope.owner ? `arty-${scope.owner}-${key}` : `arty-${key}`
}
function ensureCacheScope(): void {
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
  if (cacheIdentity && (cacheIdentity.owner !== owner || cacheIdentity.epoch !== epoch)) resetConversationMemCache()
  cacheIdentity = { owner, epoch }
}

export function sanitizeConversationPayloads(
  conversations: Conversation[],
  _now = Date.now(),
): Conversation[] {
  let changed = false
  const sanitized = conversations.map((conversation) => {
    let conversationChanged = false
    const messages = conversation.messages.map((message) => {
      // Migration temporaire : les anciennes versions pouvaient persister une
      // carte de passage vers Gmail. Elle est retirée sans condition au boot,
      // même si son ancien TTL n'est pas expiré.
      const legacyMessage = message as typeof message & { gmailSearch?: unknown }
      if (!Object.prototype.hasOwnProperty.call(legacyMessage, 'gmailSearch')) return message
      const { gmailSearch: _removed, ...safeMessage } = legacyMessage
      changed = true
      conversationChanged = true
      return safeMessage
    })
    return conversationChanged ? { ...conversation, messages } : conversation
  })
  return changed ? sanitized : conversations
}

function encryptionDisabled(): boolean {
  try {
    return localStorage.getItem(KILLSWITCH_KEY) === '1'
  } catch {
    return false
  }
}

// True once the in-memory cache reflects the real history (plain read or
// async decrypt done). While false, saveConversation() is a silent no-op —
// callers that create/append messages must check this to surface a
// "still loading" error instead of dropping the user's action (audit H5).
export function isCacheReady(): boolean {
  ensureCacheScope()
  return cacheReady
}

export function getConversations(): Conversation[] {
  ensureCacheScope()
  if (memConversations) return memConversations
  // Cold read before bootstrap. A plain copy is a migration leftover or a
  // crash-safety-net write — either way it is the freshest available state.
  const plain = scoped.getJSON<Conversation[]>(PLAIN_KEY)
  if (plain) {
    memConversations = sanitizeConversationPayloads(plain)
    cacheReady = true
    return memConversations
  }
  // No plain copy. If there is no ciphertext either, the store is genuinely
  // empty and the empty cache is authoritative. Otherwise the history is
  // locked in `conversations-enc` — only the async bootstrap can load it;
  // stay not-ready so writes don't clobber it.
  if (!scoped.getItem(ENC_KEY)) {
    memConversations = []
    cacheReady = true
  }
  return memConversations ?? []
}

export function getConversation(id: string): Conversation | null {
  return getConversations().find((c) => c.id === id) ?? null
}

function persist(list: Conversation[]): void {
  ensureCacheScope()
  const scope = captureScope()
  // Invalidate old encryptions even for killswitch/crypto-unavailable writes.
  const gen = ++writeGen
  const serialized = JSON.stringify(list)
  localStorage.setItem(physicalKey(scope, PLAIN_KEY), serialized)
  memConversations = list
  if (encryptionDisabled()) {
    localStorage.removeItem(physicalKey(scope, ENC_KEY))
    return
  }
  void persistEncrypted(serialized, gen, scope)
}

async function persistEncrypted(serialized: string, gen: number, scope: StoreScope, expectedPlain = serialized): Promise<void> {
  if (!isCryptoReady() || !scopeCurrent(scope)) return
  try {
    const blob = await encrypt(serialized)
    // Never write an older cipher over a newer commit, nor remove its safety net.
    if (!scopeCurrent(scope) || gen !== writeGen || encryptionDisabled()) return
    const plainKey = physicalKey(scope, PLAIN_KEY)
    if (localStorage.getItem(plainKey) !== expectedPlain) return
    localStorage.setItem(physicalKey(scope, ENC_KEY), blob)
    if (localStorage.getItem(plainKey) === expectedPlain) localStorage.removeItem(plainKey)
  } catch {
    // Keep the original owner's plain safety net; no migration or destructive retry.
  }
}

export function saveConversation(conversation: Conversation): void {
  const conversations = [...getConversations()]
  if (!cacheReady) {
    // History still locked in `conversations-enc` (bootstrap not done, or
    // its decrypt failed). Persisting now would overwrite it with a partial
    // list — skip. The data is not lost; a later save persists correctly.
    console.warn('[storage] saveConversation before conversations loaded — skipped to protect encrypted history')
    return
  }
  const index = conversations.findIndex((c) => c.id === conversation.id)
  if (index >= 0) {
    conversations[index] = conversation
  } else {
    conversations.unshift(conversation)
  }
  persist(conversations)
}

/** Collect every IndexedDB file reference, including generated-image URLs. */
export function collectReferencedFileIds(conversations: Conversation[]): Set<string> {
  const referencedIds = new Set<string>()
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      for (const file of message.files ?? []) {
        if (file.id) referencedIds.add(file.id)
      }
      const generatedImages = message.content.matchAll(/arty-img:\/\/([A-Za-z0-9._~-]+)/g)
      for (const match of generatedImages) referencedIds.add(match[1]!)
    }
  }
  return referencedIds
}

export function deleteConversation(id: string): void {
  const conversations = getConversations()
  if (!cacheReady) {
    console.warn('[storage] deleteConversation before conversations loaded — skipped')
    return
  }
  const deleted = conversations.find((c) => c.id === id)
  const remaining = conversations.filter((c) => c.id !== id)
  persist(remaining)
  if (!deleted) return

  // Only remove files that belonged to the deleted conversation. A global
  // orphan sweep can race with sendMessage(), which writes the IndexedDB file
  // before persisting its Message reference, and delete an in-flight upload.
  const remainingRefs = collectReferencedFileIds(remaining)
  const candidates = collectReferencedFileIds([deleted])
  for (const fileId of remainingRefs) candidates.delete(fileId)
  const ownerUserId = getActiveUserId()
  void deleteOwnedFiles(candidates, ownerUserId).catch(() => {})
}

/**
 * Decrypt conversations into the in-memory cache after crypto is ready, and
 * migrate any legacy plain-JSON copy to encrypted storage. Idempotent — safe
 * to call multiple times. Always dispatches `conversations-storage-ready` so
 * useConversation can re-read once the cache is populated (cf. BUG 43).
 */
export async function bootstrapConversationStorage(): Promise<void> {
  ensureCacheScope()
  const scope = captureScope(), ticket = ++bootstrapGen
  const current = () => scopeCurrent(scope) && ticket === bootstrapGen
  const initialWrite = writeGen
  try {
    const plainRaw = localStorage.getItem(physicalKey(scope, PLAIN_KEY))
    let plain: Conversation[] | null = null
    try { plain = plainRaw ? JSON.parse(plainRaw) as Conversation[] : null } catch { /* legacy malformed plain */ }
    if (plain) {
      memConversations = sanitizeConversationPayloads(plain)
      cacheReady = true
      if (!encryptionDisabled() && isCryptoReady()) {
        // Same generation gate as normal saves; a concurrent user save wins.
        await persistEncrypted(JSON.stringify(memConversations), initialWrite, scope, plainRaw!)
      }
      if (current() && initialWrite === writeGen) await recoverLockedBlobs(scope, current)
      return
    }
    const encKey = physicalKey(scope, ENC_KEY)
    const enc = localStorage.getItem(encKey)
    if (enc) {
      if (!isCryptoReady()) return
      try {
        const decoded = await decrypt(enc)
        if (!current() || initialWrite !== writeGen || localStorage.getItem(encKey) !== enc ||
            localStorage.getItem(physicalKey(scope, PLAIN_KEY)) !== plainRaw) return
        memConversations = sanitizeConversationPayloads(JSON.parse(decoded) as Conversation[])
        cacheReady = true
      } catch {
        if (!current() || initialWrite !== writeGen || localStorage.getItem(encKey) !== enc ||
            localStorage.getItem(physicalKey(scope, PLAIN_KEY)) !== plainRaw) return
        quarantineUndecryptableBlob(enc, scope)
      }
      if (current() && cacheReady) await recoverLockedBlobs(scope, current)
      return
    }
    memConversations = []
    cacheReady = true
    await recoverLockedBlobs(scope, current)
  } finally {
    if (current() && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('conversations-storage-ready'))
    }
  }
}

/**
 * Move an undecryptable ciphertext into a free quarantine slot and unlock the
 * cache with an empty history. The blob is PRESERVED (moved, not deleted) —
 * a later boot where the derived key matches again restores it via
 * recoverLockedBlobs(). Two slots cover the worst case: an old history locked
 * under key A, then new conversations locked under key B after a second key
 * change. If both slots are full, keep today's behaviour (stay not-ready)
 * rather than destroy anything.
 */
function quarantineUndecryptableBlob(enc: string, scope: StoreScope): void {
  if (!scopeCurrent(scope)) return
  for (const key of LOCKED_KEYS) {
    const slotKey = physicalKey(scope, key)
    if (localStorage.getItem(slotKey)) continue
    localStorage.setItem(slotKey, enc)
    if (localStorage.getItem(physicalKey(scope, ENC_KEY)) === enc) localStorage.removeItem(physicalKey(scope, ENC_KEY))
    memConversations = []
    cacheReady = true
    console.error(`[storage] conversations decrypt failed — blob quarantined under ${key}, continuing with empty history (nothing deleted)`)
    return
  }
  console.error('[storage] conversations decrypt failed — quarantine slots full, keeping blob in place; writes stay disabled')
}

/**
 * Retry quarantined ciphertexts with the current key. On success the
 * recovered conversations are merged back (current history wins on id
 * collision) and the slot is freed. Silent no-op while the key still cannot
 * decrypt them — the blobs are kept for the next attempt.
 */
async function recoverLockedBlobs(scope: StoreScope, current: () => boolean): Promise<void> {
  if (!current() || !isCryptoReady() || !memConversations || !cacheReady) return
  for (const key of LOCKED_KEYS) {
    if (!current()) return
    const slotKey = physicalKey(scope, key), blob = localStorage.getItem(slotKey)
    if (!blob) continue
    try {
      const recoveryWrite = writeGen
      const decoded = await decrypt(blob)
      // Recovery must not undo a save/delete that happened while decrypting.
      // Keep the recovery source for a later bootstrap instead of merging it.
      if (!current() || recoveryWrite !== writeGen || !memConversations || !cacheReady || localStorage.getItem(slotKey) !== blob) return
      const recovered = sanitizeConversationPayloads(JSON.parse(decoded) as Conversation[])
      // Merge into the latest current cache, not the pre-await snapshot.
      const known = new Set(memConversations.map(c => c.id))
      const merged = [...memConversations, ...recovered.filter(c => !known.has(c.id))]
      merged.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      persist(merged) // synchronous durable safety net or throw: keep slot on failure
      if (current() && localStorage.getItem(slotKey) === blob) localStorage.removeItem(slotKey)
      console.warn(`[storage] recovered ${recovered.length} conversation(s) from ${key}`)
    } catch {
      // Decrypt/quota failure: preserve the original recovery source.
    }
  }
}

/**
 * Clear the in-memory cache. Called on account switch / logout so the next
 * user's reads don't return the previous account's conversations.
 */
export function resetConversationMemCache(): void {
  resetGen++
  writeGen++
  bootstrapGen++
  cacheIdentity = null
  memConversations = null
  cacheReady = false
}
