import type { Conversation } from '../types'
import * as scoped from './scopedStorage'
import { encrypt, decrypt, isCryptoReady } from './crypto'
import { deleteOwnedFiles } from './secureFileStorage'
import { getActiveUserId } from './userSession'

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
  return cacheReady
}

export function getConversations(): Conversation[] {
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
  memConversations = list
  // Synchronous plain write — crash-safety net (BUG 16 keeps this sync).
  scoped.setJSON(PLAIN_KEY, list)
  if (encryptionDisabled()) {
    scoped.removeItem(ENC_KEY)
    return
  }
  const gen = ++writeGen
  void persistEncrypted(list, gen)
}

async function persistEncrypted(list: Conversation[], gen: number): Promise<void> {
  // Crypto not ready — leave the plain copy as the at-rest form; the next
  // bootstrap re-encrypts it.
  if (!isCryptoReady()) return
  try {
    const blob = await encrypt(JSON.stringify(list))
    scoped.setItem(ENC_KEY, blob)
    // Drop the plain net only if this is still the latest write — otherwise
    // a newer saveConversation's plain copy is current and its own encrypt
    // will clean up.
    if (gen === writeGen) scoped.removeItem(PLAIN_KEY)
  } catch {
    // Encryption failed — keep the plain copy as the at-rest fallback.
  }
}

export function saveConversation(conversation: Conversation): void {
  const conversations = getConversations()
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
  try {
    // A plain copy present at boot is canonical (written first, synchronously;
    // the ciphertext is only dropped after it is confirmed). Load it, then
    // re-encrypt and drop the plain — unless the killswitch is on.
    const plain = scoped.getJSON<Conversation[]>(PLAIN_KEY)
    if (plain) {
      memConversations = sanitizeConversationPayloads(plain)
      cacheReady = true
      if (!encryptionDisabled() && isCryptoReady()) {
        try {
          scoped.setItem(ENC_KEY, await encrypt(JSON.stringify(memConversations)))
          scoped.removeItem(PLAIN_KEY)
        } catch {
          // Keep the plain copy — re-encryption retried on the next boot.
        }
      }
      await recoverLockedBlobs()
      return
    }
    const enc = scoped.getItem(ENC_KEY)
    if (enc) {
      if (!isCryptoReady()) return // can't decrypt yet — stay not-ready
      try {
        memConversations = sanitizeConversationPayloads(
          JSON.parse(await decrypt(enc)) as Conversation[],
        )
        cacheReady = true
      } catch {
        // Decrypt failed. NEVER wipe — conversations are irreplaceable,
        // unlike Google tokens. But NEVER stay locked either : cacheReady à
        // false pour toute la session rendait l'app inutilisable (chaque
        // nouvelle conversation était droppée par saveConversation → écran
        // vide permanent sur /chat/:id). On MET EN QUARANTAINE le blob
        // (déplacé, jamais supprimé) et on repart sur un historique vide
        // utilisable. recoverLockedBlobs() retente le déchiffrement à chaque
        // boot et re-fusionne l'historique si la clé redevient la bonne.
        quarantineUndecryptableBlob(enc)
      }
      if (cacheReady) await recoverLockedBlobs()
      return
    }
    // No stored data at all — fresh user (but maybe a quarantined history
    // from a previous session: retry it now that crypto is up).
    memConversations = []
    cacheReady = true
    await recoverLockedBlobs()
  } finally {
    if (typeof window !== 'undefined') {
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
function quarantineUndecryptableBlob(enc: string): void {
  for (const key of LOCKED_KEYS) {
    if (scoped.getItem(key)) continue
    scoped.setItem(key, enc)
    scoped.removeItem(ENC_KEY)
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
async function recoverLockedBlobs(): Promise<void> {
  if (!isCryptoReady() || !memConversations || !cacheReady) return
  for (const key of LOCKED_KEYS) {
    const blob = scoped.getItem(key)
    if (!blob) continue
    try {
      const recovered = sanitizeConversationPayloads(
        JSON.parse(await decrypt(blob)) as Conversation[],
      )
      const known = new Set(memConversations.map((c) => c.id))
      const merged = [...memConversations, ...recovered.filter((c) => !known.has(c.id))]
      merged.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      persist(merged)
      scoped.removeItem(key)
      console.warn(`[storage] recovered ${recovered.length} conversation(s) from ${key}`)
    } catch {
      // Still locked under another key — keep the blob, retry next boot.
    }
  }
}

/**
 * Clear the in-memory cache. Called on account switch / logout so the next
 * user's reads don't return the previous account's conversations.
 */
export function resetConversationMemCache(): void {
  memConversations = null
  cacheReady = false
}
