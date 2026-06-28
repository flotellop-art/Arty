import { initCrypto, rotateCryptoPassphrase } from './crypto'
import * as scoped from './scopedStorage'

export const SERVER_PROVIDED_API_KEY = 'server-provided'
const LOCAL_CRYPTO_SECRET_KEY = 'local-crypto-passphrase'

export function isServerProvidedApiKey(value: string | null | undefined): boolean {
  return value === SERVER_PROVIDED_API_KEY
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function getLocalSecret(): string | null {
  const secret = scoped.getItem(LOCAL_CRYPTO_SECRET_KEY)
  return secret && secret.length >= 64 ? secret : null
}

function setLocalSecret(secret: string): void {
  scoped.setItem(LOCAL_CRYPTO_SECRET_KEY, secret)
}

export function getOrCreateLocalCryptoPassphrase(): string {
  const existing = getLocalSecret()
  if (existing) return existing
  const secret = randomSecret()
  setLocalSecret(secret)
  return secret
}

/**
 * Initialize at-rest encryption without ever using the public server-key
 * sentinel as a passphrase. BYOK users keep deriving from their Anthropic key;
 * Google/server-key users get a random per-user local secret that never leaves
 * the device. Legacy ciphertext encrypted with `server-provided` is migrated
 * in-place on first boot/login when possible.
 */
export async function initCryptoForApiKey(apiKey: string): Promise<void> {
  if (!isServerProvidedApiKey(apiKey)) {
    await initCrypto(apiKey)
    return
  }

  const existingLocal = getLocalSecret()
  if (existingLocal) {
    await initCrypto(existingLocal)
    return
  }

  const localSecret = randomSecret()
  const migrated = await rotateCryptoPassphrase(SERVER_PROVIDED_API_KEY, localSecret)
  if (!migrated) {
    await initCrypto(localSecret)
  }
  setLocalSecret(localSecret)
}
