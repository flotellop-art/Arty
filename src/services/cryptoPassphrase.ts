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
 * Initialize at-rest encryption without using a provider API key as the steady
 * local passphrase. A random per-user local secret unlocks local ciphertext and
 * lets API keys themselves be stored encrypted. On first run for a legacy BYOK
 * user, `apiKey` is used exactly once to rotate old ciphertext to the local
 * secret; on first run for a legacy Google/server-key user, the public
 * `server-provided` sentinel is likewise migrated away.
 */
export async function initCryptoForApiKey(apiKey: string): Promise<void> {
  const existingLocal = getLocalSecret()
  if (existingLocal) {
    await initCrypto(existingLocal)
    return
  }

  const localSecret = randomSecret()
  const legacyPassphrase = isServerProvidedApiKey(apiKey)
    ? SERVER_PROVIDED_API_KEY
    : apiKey
  const migrated = await rotateCryptoPassphrase(legacyPassphrase, localSecret)
  if (!migrated) {
    await initCrypto(localSecret)
  }
  setLocalSecret(localSecret)
}
