/**
 * Local AES-GCM storage, with the existing PBKDF2 v1/v2 envelopes. API-key
 * derivation (including the public server-provided marker) is NOT user-secret
 * end-to-end encryption. No bulk rewrite or deletion of existing ciphertext.
 */
import { getActiveUserId, getActiveSessionEpoch } from './userSession'
import { invalidateLocalDataViews } from './localDataInvalidation'

const SALT_KEY = 'arty-crypto-salt'
const KEY_CHECK_KEY = 'arty-crypto-check'
const VERSION_KEY = 'arty-crypto-version'
const KILLSWITCH_KEY = 'arty-crypto-v2-disabled'
type CryptoVersion = 'v1' | 'v2'
const PBKDF2_ITERATIONS = { v1: 100_000, v2: 600_000 } as const
type Scope = { owner: string | null; epoch: number }
type KeyRing = { version: CryptoVersion; keys: Record<CryptoVersion, CryptoKey> }
type CryptoContext = Scope & KeyRing & { generation: number }
let context: CryptoContext | null = null
let initGeneration = 0
let pendingGeneration: number | null = null
let latestInitialization: Promise<void> | null = null

/** Cancellation must never be interpreted as damaged encrypted data. */
export class CryptoContextChanged extends Error {
  constructor() { super('Crypto context changed'); this.name = 'CryptoContextChanged' }
}
export function isCryptoContextChanged(error: unknown): boolean {
  return error instanceof CryptoContextChanged
}
function captureScope(): Scope { return { owner: getActiveUserId(), epoch: getActiveSessionEpoch() } }
function scopeCurrent(scope: Scope): boolean {
  return scope.owner === getActiveUserId() && scope.epoch === getActiveSessionEpoch()
}
function metadataKey(scope: Scope, key: string): string {
  return scope.owner ? `arty-${scope.owner}-${key.replace(/^arty-/, '')}` : key
}
function currentContext(): CryptoContext | null {
  return context && context.generation === initGeneration && scopeCurrent(context) ? context : null
}
/** Capture before a caller's first await, not just when it starts encryption. */
export function captureCryptoGuard(): () => boolean {
  const captured = currentContext()
  return () => captured !== null && captured === currentContext()
}
function requireContext(): CryptoContext {
  const captured = currentContext()
  if (!captured) throw new CryptoContextChanged()
  return captured
}
function assertContext(captured: CryptoContext): void {
  if (captured !== currentContext()) throw new CryptoContextChanged()
}

function targetVersion(): CryptoVersion {
  try { return localStorage.getItem(KILLSWITCH_KEY) === '1' ? 'v1' : 'v2' } catch { return 'v2' }
}
function storedVersion(scope: Scope): CryptoVersion {
  const key = metadataKey(scope, VERSION_KEY)
  return (localStorage.getItem(key) ?? (key !== VERSION_KEY ? localStorage.getItem(VERSION_KEY) : null)) === 'v2' ? 'v2' : 'v1'
}
function getSalt(scope: Scope, create = true): Uint8Array {
  const key = metadataKey(scope, SALT_KEY)
  const own = localStorage.getItem(key)
  if (own) return new Uint8Array(JSON.parse(own))
  const legacy = key !== SALT_KEY ? localStorage.getItem(SALT_KEY) : null
  if (legacy) {
    if (create) localStorage.setItem(key, legacy)
    return new Uint8Array(JSON.parse(legacy))
  }
  if (!create) throw new Error('Crypto salt unavailable')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  localStorage.setItem(key, JSON.stringify(Array.from(salt)))
  return salt
}
async function deriveKeys(passphrase: string, salt: Uint8Array): Promise<Record<CryptoVersion, CryptoKey>> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const derive = (version: CryptoVersion) => crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS[version], hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
  const [v1, v2] = await Promise.all([derive('v1'), derive('v2')])
  return { v1, v2 }
}
function encryptedKeys(scope: Scope): string[] {
  const prefix = scope.owner ? `arty-${scope.owner}-` : 'arty-'
  return Object.keys(localStorage).filter(key => key.startsWith(prefix) && key.endsWith('-enc'))
}

export interface CryptoInitOptions {
  /** UI cancellation, checked before any candidate publication or marker write. */
  assertCurrent?: () => void
  /** Synchronous credential persistence, after derivation but before publication.
   * Must throw before changing active keys if durable persistence fails. */
  commit?: () => void
}
/** Explicit credential edits wait for the current cold/session initialization. */
export async function waitForCryptoInitialization(): Promise<void> {
  while (latestInitialization) await latestInitialization.catch(() => {})
}
export function initCrypto(passphrase: string, options: CryptoInitOptions = {}): Promise<void> {
  const task = initializeCrypto(passphrase, options)
  latestInitialization = task
  void task.finally(() => { if (latestInitialization === task) latestInitialization = null }).catch(() => {})
  return task
}
/**
 * A candidate stays local throughout derivation/verification. Latest init wins;
 * old operations are cancelled, not quarantined. A wrong credential preserves
 * old markers and still publishes its candidate for non-destructive recovery.
 */
async function initializeCrypto(passphrase: string, options: CryptoInitOptions): Promise<void> {
  const scope = captureScope(), generation = ++initGeneration
  invalidateLocalDataViews()
  const previous = context && scopeCurrent(context) ? context : null
  // Retain the last committed ring for rollback through overlapping attempts;
  // its old generation makes it unusable while a candidate is pending.
  if (!previous) context = null
  pendingGeneration = generation
  const assertAttempt = () => {
    if (!scopeCurrent(scope) || generation !== initGeneration) throw new CryptoContextChanged()
    options.assertCurrent?.()
  }
  const checkKey = metadataKey(scope, KEY_CHECK_KEY), versionKey = metadataKey(scope, VERSION_KEY)
  let oldCheck: string | null = null, oldVersion: string | null = null
  let writtenCheck: string | undefined, wroteVersion = false
  try {
    assertAttempt()
    oldCheck = localStorage.getItem(checkKey); oldVersion = localStorage.getItem(versionKey)
    const version = targetVersion()
    const keys = await deriveKeys(passphrase, getSalt(scope))
    assertAttempt()
    const candidate: CryptoContext = { ...scope, generation, version, keys }
    let mayWriteCheck = false
    if (oldCheck) {
      try { mayWriteCheck = (await decryptWithRing(oldCheck, candidate)) === 'arty-ok' } catch { /* wrong credential: preserve marker */ }
      assertAttempt()
    } else {
      const legacy = checkKey !== KEY_CHECK_KEY ? localStorage.getItem(KEY_CHECK_KEY) : null
      if (legacy) {
        try { mayWriteCheck = (await decryptWithRing(legacy, candidate)) === 'arty-ok' } catch { /* another account */ }
        assertAttempt()
      }
      if (!mayWriteCheck) {
        mayWriteCheck = true
        for (const key of encryptedKeys(scope)) {
          const raw = localStorage.getItem(key)
          try { if (raw) await decryptWithRing(raw, candidate) } catch { mayWriteCheck = false }
          assertAttempt()
          if (!mayWriteCheck) break
        }
      }
    }
    const nextCheck = mayWriteCheck ? await encryptWithRing('arty-ok', candidate) : undefined
    assertAttempt()
    // Do not rewind another window's marker while this derivation was pending.
    if (localStorage.getItem(checkKey) !== oldCheck || localStorage.getItem(versionKey) !== oldVersion) throw new CryptoContextChanged()
    if (nextCheck !== undefined) {
      localStorage.setItem(checkKey, nextCheck); writtenCheck = nextCheck
      localStorage.setItem(versionKey, version); wroteVersion = true
    }
    options.commit?.()
    context = candidate
  } catch (error) {
    // Restore only our own marker writes. No ciphertext or salt is removed.
    // This is best-effort localStorage recovery, not an atomic multi-key store.
    if (generation === initGeneration && scopeCurrent(scope)) {
      try {
        if (writtenCheck !== undefined && localStorage.getItem(checkKey) === writtenCheck) {
          if (oldCheck === null) localStorage.removeItem(checkKey); else localStorage.setItem(checkKey, oldCheck)
        }
        if (wroteVersion) {
          if (oldVersion === null) localStorage.removeItem(versionKey); else localStorage.setItem(versionKey, oldVersion)
        }
      } catch { /* Keep recoverable ciphertext; caller gets the original failure. */ }
      // A failed BYOK commit must not leave new crypto with old API credentials.
      context = previous ? { ...previous, generation } : null
    }
    throw error
  } finally {
    if (pendingGeneration === generation) pendingGeneration = null
  }
}

/** Verify locally: never swap or restore the active global key ring. */
export async function verifyCrypto(passphrase: string): Promise<boolean> {
  const scope = captureScope(), generation = initGeneration
  const checkKey = metadataKey(scope, KEY_CHECK_KEY), check = localStorage.getItem(checkKey)
  if (!check) return false
  try {
    const ring = { keys: await deriveKeys(passphrase, getSalt(scope, false)), version: storedVersion(scope) }
    const valid = (await decryptWithRing(check, ring)) === 'arty-ok'
    return scopeCurrent(scope) && generation === initGeneration && localStorage.getItem(checkKey) === check && valid
  } catch { return false }
}
/** Ready means a candidate for this session, not that all history is unlocked. */
export function isCryptoReady(): boolean { return currentContext() !== null }
export function isCryptoInitializing(): boolean { return pendingGeneration === initGeneration }
export async function selfTestCrypto(): Promise<boolean> {
  const captured = currentContext()
  if (!captured) return false
  const check = localStorage.getItem(metadataKey(captured, KEY_CHECK_KEY))
  if (!check) return true
  try {
    const valid = (await decryptWithRing(check, captured)) === 'arty-ok'
    assertContext(captured)
    return valid
  } catch (error) {
    assertContext(captured)
    if (isCryptoContextChanged(error)) throw error
    return false
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
async function encryptWithRing(plaintext: string, ring: KeyRing): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ring.keys[ring.version], new TextEncoder().encode(plaintext))
  const packed = new Uint8Array(iv.length + ciphertext.byteLength)
  packed.set(iv); packed.set(new Uint8Array(ciphertext), iv.length)
  return `${ring.version}:${bytesToBase64(packed)}`
}
export async function encrypt(plaintext: string): Promise<string> {
  const captured = requireContext()
  const result = await encryptWithRing(plaintext, captured)
  assertContext(captured)
  return result
}
async function decryptWithKey(encoded: string, key: CryptoKey): Promise<string> {
  const packed = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12))
  return new TextDecoder().decode(plaintext)
}
async function decryptWithRing(encoded: string, ring: KeyRing): Promise<string> {
  const envelope = /^(v1|v2):(.*)$/s.exec(encoded)
  if (envelope) return decryptWithKey(envelope[2]!, ring.keys[envelope[1] as CryptoVersion])
  const versions: CryptoVersion[] = ring.version === 'v1' ? ['v1', 'v2'] : ['v2', 'v1']
  let lastError: unknown
  for (const version of versions) {
    try { return await decryptWithKey(encoded, ring.keys[version]) } catch (error) { lastError = error }
  }
  throw lastError ?? new Error('Unable to decrypt ciphertext')
}
export async function decrypt(encoded: string): Promise<string> {
  const captured = requireContext()
  try {
    const result = await decryptWithRing(encoded, captured)
    assertContext(captured)
    return result
  } catch (error) {
    assertContext(captured) // turn late failure into cancellation, not corruption
    throw error
  }
}

/** Legacy wrapper; the existing no-crypto plain fallback is NOT used by projects. */
export async function secureSet(key: string, value: unknown): Promise<void> {
  const captured = currentContext()
  if (!captured) {
    if (isCryptoInitializing()) throw new CryptoContextChanged()
    localStorage.setItem(key, JSON.stringify(value)); return
  }
  const encrypted = await encrypt(JSON.stringify(value))
  assertContext(captured)
  localStorage.setItem(key, encrypted)
}
export async function secureGet<T>(key: string): Promise<T | null> {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  const captured = currentContext()
  if (captured) {
    try {
      const json = await decrypt(raw)
      assertContext(captured)
      return JSON.parse(json) as T
    } catch (error) {
      assertContext(captured)
      if (isCryptoContextChanged(error)) throw error
    }
  }
  try { return JSON.parse(raw) as T } catch { return null }
}
export async function migrateKey(key: string): Promise<void> {
  const captured = currentContext()
  if (!captured) return
  const raw = localStorage.getItem(key)
  if (!raw) return
  try { JSON.parse(raw) } catch { return }
  const encrypted = await encrypt(raw)
  assertContext(captured)
  if (localStorage.getItem(key) === raw) localStorage.setItem(key, encrypted)
}
