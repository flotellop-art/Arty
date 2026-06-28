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

// ─── Version helpers ───

function getStoredVersion(): CryptoVersion {
  try {
    const raw = localStorage.getItem(VERSION_KEY)
    return raw === 'v2' ? 'v2' : 'v1'
  } catch {
    return 'v1'
  }
}

function setStoredVersion(v: CryptoVersion): void {
  try { localStorage.setItem(VERSION_KEY, v) } catch { /* quota / SSR */ }
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
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.endsWith('-enc')) out.push(k)
    }
  } catch { /* SSR / privacy mode */ }
  return out
}

// ─── Key derivation ───

async function getSalt(): Promise<Uint8Array> {
  const existing = localStorage.getItem(SALT_KEY)
  if (existing) {
    return new Uint8Array(JSON.parse(existing))
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  localStorage.setItem(SALT_KEY, JSON.stringify(Array.from(salt)))
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
  const storedVersion = getStoredVersion()
  const hasExistingCheck = !!localStorage.getItem(KEY_CHECK_KEY)

  // 1) Fresh install — pas de check existant, on initialise direct au target.
  if (!hasExistingCheck) {
    cachedKey = await deriveKey(passphrase, targetVersion)
    const check = await encrypt('arty-ok')
    localStorage.setItem(KEY_CHECK_KEY, check)
    setStoredVersion(targetVersion)
    return
  }

  // 2) Déjà à la version target → flow normal.
  if (storedVersion === targetVersion) {
    cachedKey = await deriveKey(passphrase, targetVersion)
    return
  }

  // 3) Migration v1 → v2 (ou inversement si killswitch).
  // 3a) Vérifier que la passphrase est correcte avec l'ancien algo.
  const oldKey = await deriveKey(passphrase, storedVersion)
  const prevCachedKey = cachedKey
  cachedKey = oldKey
  let isValid = false
  try {
    isValid = (await decrypt(localStorage.getItem(KEY_CHECK_KEY)!)) === 'arty-ok'
  } catch {
    isValid = false
  }

  if (!isValid) {
    // Mauvaise passphrase. NE PAS migrer, NE PAS wiper (BUG 47). On garde
    // oldKey en cache pour cohérence avec l'ancien comportement — les
    // callers verront `selfTestCrypto = false` et retesteront plus tard.
    cachedKey = prevCachedKey ?? oldKey
    return
  }

  // 3b) Passphrase OK. Décrypter tous les blobs avec oldKey, ré-encrypter
  // avec newKey. La séquence importe : on collecte d'abord tous les plaintexts
  // (oldKey actif), puis on swap cachedKey, puis on ré-écrit.
  const blobs = listEncryptedKeys().filter((k) => k !== KEY_CHECK_KEY)
  const decrypted: Array<[string, string]> = []
  for (const k of blobs) {
    try {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const plain = await decrypt(raw)
      decrypted.push([k, plain])
    } catch {
      // Blob illisible avec oldKey — peut-être déjà à v2 (migration partielle
      // précédente kill switchée) ou corrompu. On skip sans casser.
    }
  }

  const newKey = await deriveKey(passphrase, targetVersion)
  cachedKey = newKey
  for (const [k, plain] of decrypted) {
    try {
      const encNew = await encrypt(plain)
      localStorage.setItem(k, encNew)
    } catch {
      // En cas d'échec de re-encrypt, on garde l'ancien blob (qui n'est plus
      // lisible avec newKey). Le prochain boot retentera la migration depuis
      // v1 (puisque setStoredVersion n'a pas encore été appelé).
    }
  }

  // Réécrire KEY_CHECK_KEY EN DERNIER. Si on crash avant cette ligne, le
  // prochain boot lit storedVersion=v1 et retente la migration.
  const newCheck = await encrypt('arty-ok')
  localStorage.setItem(KEY_CHECK_KEY, newCheck)
  setStoredVersion(targetVersion)
}


/**
 * Rotate all encrypted local blobs from one passphrase to another without
 * changing the user's data. Used to migrate legacy Google/server-key accounts
 * away from the public `server-provided` placeholder as an at-rest key.
 */
export async function rotateCryptoPassphrase(
  oldPassphrase: string,
  newPassphrase: string
): Promise<boolean> {
  const targetVersion: CryptoVersion = isV2Disabled() ? 'v1' : 'v2'
  const storedVersion = getStoredVersion()
  const check = localStorage.getItem(KEY_CHECK_KEY)

  if (!check) {
    await initCrypto(newPassphrase)
    return true
  }

  const previousKey = cachedKey
  const oldKey = await deriveKey(oldPassphrase, storedVersion)
  cachedKey = oldKey

  try {
    if ((await decrypt(check)) !== 'arty-ok') {
      cachedKey = previousKey
      return false
    }
  } catch {
    cachedKey = previousKey
    return false
  }

  const blobs = listEncryptedKeys().filter((k) => k !== KEY_CHECK_KEY)
  const decrypted: Array<[string, string]> = []
  for (const key of blobs) {
    const raw = localStorage.getItem(key)
    if (!raw) continue
    try {
      decrypted.push([key, await decrypt(raw)])
    } catch {
      // Keep unreadable blobs untouched. The old key self-test passed, so a
      // failure here means this individual blob is corrupt or from another
      // historical key; do not let it block the global key rotation.
    }
  }

  cachedKey = await deriveKey(newPassphrase, targetVersion)
  for (const [key, plaintext] of decrypted) {
    localStorage.setItem(key, await encrypt(plaintext))
  }
  localStorage.setItem(KEY_CHECK_KEY, await encrypt('arty-ok'))
  setStoredVersion(targetVersion)
  return true
}

/**
 * Verify if the given passphrase matches the stored key. Utilise la version
 * stockée (pas la target) pour vérifier — sinon on dirait à tort que la
 * passphrase est mauvaise alors qu'elle est juste en attente de migration.
 */
export async function verifyCrypto(passphrase: string): Promise<boolean> {
  const check = localStorage.getItem(KEY_CHECK_KEY)
  if (!check) return false

  const storedVersion = getStoredVersion()
  const prevKey = cachedKey
  try {
    const tempKey = await deriveKey(passphrase, storedVersion)
    cachedKey = tempKey
    const result = await decrypt(check)
    return result === 'arty-ok'
  } catch {
    return false
  } finally {
    cachedKey = prevKey
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
  const check = localStorage.getItem(KEY_CHECK_KEY)
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
  if (!cachedKey) throw new Error('Crypto not initialized')

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

  return bytesToBase64(packed)
}

/**
 * Decrypt a base64-encoded ciphertext. Returns the original string.
 */
export async function decrypt(encoded: string): Promise<string> {
  if (!cachedKey) throw new Error('Crypto not initialized')

  const packed = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  const iv = packed.slice(0, 12)
  const ciphertext = packed.slice(12)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cachedKey,
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
