/**
 * Secure storage using AES-256-GCM via Web Crypto API.
 * No external dependency — uses the browser's native crypto.
 *
 * The encryption key is derived from the user's API key via PBKDF2.
 * This means data is only readable with the correct API key.
 *
 * Étape 9 audit (PR 9a) : PBKDF2 100k → 600k itérations (OWASP 2024+).
 * Versioning au niveau localStorage pour migrer les users existants en lazy
 * (à la prochaine initCrypto réussie) sans wipe destructif. Killswitch
 * `arty-crypto-v2-disabled = '1'` pour rollback rapide via DevTools.
 */

import { getActiveUserId } from './userSession'

const SALT_KEY = 'arty-crypto-salt'
const KEY_CHECK_KEY = 'arty-crypto-check'
const VERSION_KEY = 'arty-crypto-version'
const KILLSWITCH_KEY = 'arty-crypto-v2-disabled'

type CryptoVersion = 'v1' | 'v2'

/**
 * Itérations PBKDF2 par version. v1 (legacy 100k) conservée pour migrer
 * les blobs des users qui ont déjà chiffré avec l'ancien algo — un swap
 * brutal vers 600k invaliderait KEY_CHECK_KEY → BUG 47 régresserait
 * (l'app croirait à une mauvaise passphrase). v2 = 600k, recommandation
 * OWASP 2024 pour SHA-256.
 */
const PBKDF2_ITERATIONS: Record<CryptoVersion, number> = {
  v1: 100_000,
  v2: 600_000,
}

let cachedKey: CryptoKey | null = null
let cachedVersion: CryptoVersion | null = null
let cachedKeys: Partial<Record<CryptoVersion, CryptoKey>> = {}

/**
 * Crypto metadata must be isolated exactly like the encrypted payloads. The
 * legacy application kept one global check/version marker, so migrating user A
 * could advance the version while user B still had v1 ciphertext. Keep the
 * legacy keys only as a no-session fallback and migration source.
 */
function scopedMetadataKey(legacyKey: string): string {
  const userId = getActiveUserId()
  return userId ? `arty-${userId}-${legacyKey.replace(/^arty-/, '')}` : legacyKey
}

// ─── Version helpers ───

function getStoredVersion(): CryptoVersion {
  try {
    const key = scopedMetadataKey(VERSION_KEY)
    const raw = localStorage.getItem(key) ?? (key !== VERSION_KEY ? localStorage.getItem(VERSION_KEY) : null)
    return raw === 'v2' ? 'v2' : 'v1'
  } catch {
    return 'v1'
  }
}

function setStoredVersion(v: CryptoVersion): void {
  localStorage.setItem(scopedMetadataKey(VERSION_KEY), v)
}

/**
 * Killswitch d'urgence : si la migration v2 casse en prod, set
 * `arty-crypto-v2-disabled = '1'` via DevTools force le retour à v1 (100k)
 * sans rollback APK. NE DOIT PAS être utilisé en routine — c'est un fallback
 * en cas d'incident massif (ex: regression on initCrypto qui wipe tout).
 */
function isV2Disabled(): boolean {
  try { return localStorage.getItem(KILLSWITCH_KEY) === '1' } catch { return false }
}

/**
 * Liste les clés localStorage qui contiennent des blobs chiffrés (convention :
 * suffixe `-enc`). Utilisé par la migration v1→v2 pour re-chiffrer tous les
 * blobs avec la nouvelle clé. Couvre google-tokens-enc, google-user-enc,
 * arty-*-file-*-enc (secureFileStorage), etc. sans devoir exposer la liste
 * depuis chaque module.
 */
function listEncryptedKeys(): string[] {
  const out: string[] = []
  const userId = getActiveUserId()
  const prefix = userId ? `arty-${userId}-` : 'arty-'
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix) && k.endsWith('-enc')) out.push(k)
    }
  } catch { /* SSR / privacy mode */ }
  return out
}

// ─── Key derivation ───

async function getSalt(): Promise<Uint8Array> {
  const key = scopedMetadataKey(SALT_KEY)
  const existing = localStorage.getItem(key)
  if (existing) {
    return new Uint8Array(JSON.parse(existing))
  }

  // Existing installations encrypted every account with the same legacy salt.
  // Copy it once into the account scope so old ciphertext remains readable;
  // fresh installations/users without a legacy salt get an independent salt.
  const legacy = key !== SALT_KEY ? localStorage.getItem(SALT_KEY) : null
  if (legacy) {
    localStorage.setItem(key, legacy)
    return new Uint8Array(JSON.parse(legacy))
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  localStorage.setItem(key, JSON.stringify(Array.from(salt)))
  return salt
}

async function deriveKey(passphrase: string, version: CryptoVersion): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const salt = await getSalt()

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS[version], hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ─── Public API ───

/**
 * Initialize encryption with the user's passphrase (API key).
 * Must be called before secureSet/secureGet.
 *
 * Versioning behavior (étape 9 audit) :
 * 1. Fresh install (no KEY_CHECK_KEY) → write check + version directly at target.
 * 2. Stored version matches target → derive normally.
 * 3. Stored version is v1 but target is v2 → verify passphrase against old
 *    iterations, then re-encrypt all `*-enc` blobs + KEY_CHECK_KEY with the
 *    new iterations, finally bump the version marker. **No wipe on failure**
 *    (cf. BUG 47) — if passphrase is wrong, we keep the old key cached.
 */
export async function initCrypto(passphrase: string): Promise<void> {
  const targetVersion: CryptoVersion = isV2Disabled() ? 'v1' : 'v2'
  const checkKey = scopedMetadataKey(KEY_CHECK_KEY)
  // Keep both derivations available. New ciphertext carries its version in an
  // envelope, while legacy ciphertext (without an envelope) is tried with both
  // keys. This removes the unsafe in-place bulk rewrite: a WebView may close at
  // any instruction without ever leaving a mixed, marker-dependent state.
  const [v1, v2] = await Promise.all([
    deriveKey(passphrase, 'v1'),
    deriveKey(passphrase, 'v2'),
  ])
  cachedKeys = { v1, v2 }
  cachedVersion = targetVersion
  cachedKey = cachedKeys[targetVersion]!

  const scopedCheck = localStorage.getItem(checkKey)
  if (scopedCheck) {
    try {
      if ((await decrypt(scopedCheck)) !== 'arty-ok') return
    } catch {
      // A changed/wrong passphrase must never wipe or rewrite the old marker.
      // Keep the candidate key cached so storage bootstraps can quarantine data
      // non-destructively and the user can retry with the former credential.
      return
    }

    // Migrating the tiny check is crash-safe because its envelope identifies
    // the derivation independently from the version marker. User blobs remain
    // untouched and readable through the dual-key legacy fallback.
    localStorage.setItem(checkKey, await encrypt('arty-ok'))
    setStoredVersion(targetVersion)
    return
  }

  // Adoption from the old global metadata. The global check may belong to a
  // different account, so only trust it if this passphrase opens it. If it
  // does not, validate every blob in the active account prefix. This also
  // repairs installations where a previous global v1→v2 migration stopped
  // halfway: each unversioned blob is tried independently with v2 then v1.
  let identityConfirmed = false
  if (checkKey !== KEY_CHECK_KEY) {
    const legacyCheck = localStorage.getItem(KEY_CHECK_KEY)
    if (legacyCheck) {
      try { identityConfirmed = (await decrypt(legacyCheck)) === 'arty-ok' } catch { /* another account */ }
    }
  }

  const blobs = listEncryptedKeys()
  if (!identityConfirmed && blobs.length > 0) {
    try {
      for (const key of blobs) {
        const raw = localStorage.getItem(key)
        if (raw) await decrypt(raw)
      }
      identityConfirmed = true
    } catch {
      // Preserve unreadable data and leave the account without a new marker.
      return
    }
  }

  // Fresh account (no blobs) or verified legacy account.
  localStorage.setItem(checkKey, await encrypt('arty-ok'))
  setStoredVersion(targetVersion)
}

/**
 * Verify if the given passphrase matches the stored key. Utilise la version
 * stockée (pas la target) pour vérifier — sinon on dirait à tort que la
 * passphrase est mauvaise alors qu'elle est juste en attente de migration.
 */
export async function verifyCrypto(passphrase: string): Promise<boolean> {
  const check = localStorage.getItem(scopedMetadataKey(KEY_CHECK_KEY))
  if (!check) return false

  const previousKey = cachedKey
  const previousVersion = cachedVersion
  const previousKeys = cachedKeys
  try {
    const [v1, v2] = await Promise.all([
      deriveKey(passphrase, 'v1'),
      deriveKey(passphrase, 'v2'),
    ])
    cachedKeys = { v1, v2 }
    cachedVersion = getStoredVersion()
    cachedKey = cachedKeys[cachedVersion]!
    return (await decrypt(check)) === 'arty-ok'
  } catch {
    return false
  } finally {
    cachedKey = previousKey
    cachedVersion = previousVersion
    cachedKeys = previousKeys
  }
}

/**
 * Returns true if crypto has been initialized.
 */
export function isCryptoReady(): boolean {
  return cachedKey !== null
}

/**
 * Returns true if the currently cached key can decrypt KEY_CHECK_KEY.
 * Used by callers (bootstrapGoogleStorage) to distinguish "blob genuinely
 * corrupt" (key OK, decrypt fails) from "wrong passphrase loaded" (key
 * mismatch, decrypt fails on every blob). The latter must NOT trigger a
 * destructive wipe — see BUG 43, BUG 47.
 */
export async function selfTestCrypto(): Promise<boolean> {
  if (!cachedKey) return false
  const check = localStorage.getItem(scopedMetadataKey(KEY_CHECK_KEY))
  if (!check) return true
  try {
    return (await decrypt(check)) === 'arty-ok'
  } catch {
    return false
  }
}

/**
 * Base64-encode bytes by 8 KB chunks. A naive `String.fromCharCode(...bytes)`
 * spreads the whole array into call arguments → RangeError on large payloads
 * (conversation blobs sont de l'ordre du Mo). Cf. BUG 50.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Encrypt a string value. Returns a base64-encoded ciphertext.
 */
export async function encrypt(plaintext: string): Promise<string> {
  if (!cachedKey || !cachedVersion) throw new Error('Crypto not initialized')

  const enc = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cachedKey,
    enc.encode(plaintext)
  )

  // Pack IV + ciphertext
  const packed = new Uint8Array(iv.length + new Uint8Array(ciphertext).length)
  packed.set(iv)
  packed.set(new Uint8Array(ciphertext), iv.length)

  return `${cachedVersion}:${bytesToBase64(packed)}`
}

/**
 * Decrypt a base64-encoded ciphertext. Returns the original string.
 */
export async function decrypt(encoded: string): Promise<string> {
  if (!cachedKey) throw new Error('Crypto not initialized')

  const envelope = /^(v1|v2):(.*)$/s.exec(encoded)
  if (envelope) {
    const key = cachedKeys[envelope[1] as CryptoVersion]
    if (!key) throw new Error('Crypto version not initialized')
    return decryptWithKey(envelope[2]!, key)
  }

  // Legacy blobs have no version envelope. Try the active version first, then
  // the other derivation. This is what makes an old partially migrated account
  // recoverable without mutating its ciphertext in place.
  const attempts = [
    cachedKey,
    ...(['v1', 'v2'] as CryptoVersion[])
      .map((version) => cachedKeys[version])
      .filter((key): key is CryptoKey => !!key && key !== cachedKey),
  ]
  let lastError: unknown
  for (const key of attempts) {
    try { return await decryptWithKey(encoded, key) } catch (error) { lastError = error }
  }
  throw lastError ?? new Error('Unable to decrypt ciphertext')
}

async function decryptWithKey(encoded: string, key: CryptoKey): Promise<string> {

  const packed = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  const iv = packed.slice(0, 12)
  const ciphertext = packed.slice(12)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )

  return new TextDecoder().decode(plaintext)
}

// ─── Secure localStorage wrappers ───

/**
 * Store data encrypted in localStorage.
 */
export async function secureSet(key: string, value: unknown): Promise<void> {
  if (!cachedKey) {
    // Fallback: store as plain JSON if crypto not ready (first launch)
    localStorage.setItem(key, JSON.stringify(value))
    return
  }

  const json = JSON.stringify(value)
  const encrypted = await encrypt(json)
  localStorage.setItem(key, encrypted)
}

/**
 * Read and decrypt data from localStorage.
 * Falls back to reading plain JSON for migration from unencrypted data.
 */
export async function secureGet<T>(key: string): Promise<T | null> {
  const raw = localStorage.getItem(key)
  if (!raw) return null

  // Try decrypting first
  if (cachedKey) {
    try {
      const json = await decrypt(raw)
      return JSON.parse(json) as T
    } catch {
      // Decryption failed — might be old unencrypted data, try plain JSON
    }
  }

  // Fallback: try parsing as plain JSON (migration path)
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Migrate a localStorage key from plain to encrypted.
 * Does nothing if crypto isn't ready or key doesn't exist.
 */
export async function migrateKey(key: string): Promise<void> {
  if (!cachedKey) return
  const raw = localStorage.getItem(key)
  if (!raw) return

  // Check if already encrypted (base64 that's NOT valid JSON)
  try {
    JSON.parse(raw)
    // It's valid JSON = unencrypted. Re-encrypt it.
    const encrypted = await encrypt(raw)
    localStorage.setItem(key, encrypted)
  } catch {
    // Not valid JSON = probably already encrypted or corrupted. Leave it.
  }
}
