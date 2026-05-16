import type { Conversation } from '../types'
import * as scoped from './scopedStorage'
import { encrypt, decrypt, isCryptoReady } from './crypto'

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

function encryptionDisabled(): boolean {
  try {
    return localStorage.getItem(KILLSWITCH_KEY) === '1'
  } catch {
    return false
  }
}

export function getConversations(): Conversation[] {
  if (memConversations) return memConversations
  // Cold read before bootstrap. A plain copy is a migration leftover or a
  // crash-safety-net write — either way it is the freshest available state.
  const plain = scoped.getJSON<Conversation[]>(PLAIN_KEY)
  if (plain) {
    memConversations = plain
    cacheReady = true
    return plain
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

export function deleteConversation(id: string): void {
  const conversations = getConversations()
  if (!cacheReady) {
    console.warn('[storage] deleteConversation before conversations loaded — skipped')
    return
  }
  persist(conversations.filter((c) => c.id !== id))
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
      memConversations = plain
      cacheReady = true
      if (!encryptionDisabled() && isCryptoReady()) {
        try {
          scoped.setItem(ENC_KEY, await encrypt(JSON.stringify(plain)))
          scoped.removeItem(PLAIN_KEY)
        } catch {
          // Keep the plain copy — re-encryption retried on the next boot.
        }
      }
      return
    }
    const enc = scoped.getItem(ENC_KEY)
    if (enc) {
      if (!isCryptoReady()) return // can't decrypt yet — stay not-ready
      try {
        memConversations = JSON.parse(await decrypt(enc)) as Conversation[]
        cacheReady = true
      } catch {
        // Decrypt failed. NEVER wipe — conversations are irreplaceable,
        // unlike Google tokens. Keep the blob, leave the cache empty, retry
        // on the next boot. Writes stay disabled (cacheReady === false) so
        // the blob is not overwritten.
        console.warn('[storage] conversations decrypt failed — keeping blob, will retry next boot')
      }
      return
    }
    // No stored data at all — fresh user.
    memConversations = []
    cacheReady = true
  } finally {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('conversations-storage-ready'))
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
