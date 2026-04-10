/**
 * Secure storage using AES-256-GCM via Web Crypto API.
 * No external dependency — uses the browser's native crypto.
 *
 * The encryption key is derived from the user's API key via PBKDF2.
 * This means data is only readable with the correct API key.
 */

const SALT_KEY = 'arty-crypto-salt'
const KEY_CHECK_KEY = 'arty-crypto-check'

let cachedKey: CryptoKey | null = null

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

async function deriveKey(passphrase: string): Promise<CryptoKey> {
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
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
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
 */
export async function initCrypto(passphrase: string): Promise<void> {
  cachedKey = await deriveKey(passphrase)

  // Store a check value so we can verify the key is correct on next load
  const check = await encrypt('arty-ok')
  localStorage.setItem(KEY_CHECK_KEY, check)
}

/**
 * Verify if the given passphrase matches the stored key.
 */
export async function verifyCrypto(passphrase: string): Promise<boolean> {
  const check = localStorage.getItem(KEY_CHECK_KEY)
  if (!check) return false

  try {
    const tempKey = await deriveKey(passphrase)
    const prevKey = cachedKey
    cachedKey = tempKey
    const result = await decrypt(check)
    cachedKey = prevKey
    return result === 'arty-ok'
  } catch {
    return false
  }
}

/**
 * Returns true if crypto has been initialized.
 */
export function isCryptoReady(): boolean {
  return cachedKey !== null
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

  return btoa(String.fromCharCode(...packed))
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
