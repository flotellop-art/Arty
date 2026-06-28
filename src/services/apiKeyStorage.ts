import { isCryptoReady } from './crypto'
import { initCryptoForApiKey, SERVER_PROVIDED_API_KEY } from './cryptoPassphrase'
import * as scoped from './scopedStorage'

export interface StoredApiKeys {
  anthropic: string
  gemini?: string
  mistral?: string
  openai?: string
}

export const API_KEYS_STORAGE_KEY = 'api-keys'

function normalizeApiKeys(value: unknown): StoredApiKeys | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.anthropic !== 'string' || raw.anthropic.length === 0) return null
  return {
    anthropic: raw.anthropic,
    gemini: typeof raw.gemini === 'string' && raw.gemini.length > 0 ? raw.gemini : undefined,
    mistral: typeof raw.mistral === 'string' && raw.mistral.length > 0 ? raw.mistral : undefined,
    openai: typeof raw.openai === 'string' && raw.openai.length > 0 ? raw.openai : undefined,
  }
}

/**
 * Reads only legacy plaintext API keys. This is intentionally narrow and used
 * before crypto bootstrap so we can rotate legacy ciphertext that was derived
 * from the Anthropic key, then immediately overwrite the plaintext key blob.
 */
export function readLegacyPlainApiKeys(): StoredApiKeys | null {
  const raw = scoped.getItem(API_KEYS_STORAGE_KEY)
  if (!raw) return null
  try {
    return normalizeApiKeys(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function loadApiKeys(): Promise<StoredApiKeys | null> {
  const keys = await scoped.secureGetJSON<StoredApiKeys>(API_KEYS_STORAGE_KEY)
  return normalizeApiKeys(keys)
}

export async function saveApiKeys(keys: StoredApiKeys): Promise<void> {
  const normalized = normalizeApiKeys(keys)
  if (!normalized) throw new Error('Invalid API keys')
  if (!isCryptoReady()) throw new Error('Crypto not initialized')
  await scoped.secureSetJSONStrict(API_KEYS_STORAGE_KEY, normalized)
}

export function clearApiKeys(): void {
  scoped.removeItem(API_KEYS_STORAGE_KEY)
}

/**
 * Chokepoint for restoring BYOK/server-key credentials for the active scoped
 * user. Normal path: initialize crypto from the per-user local secret and read
 * encrypted keys. Legacy path: if api-keys is still plaintext, use the
 * Anthropic key once to rotate existing old ciphertext, then rewrite api-keys
 * strictly encrypted so localStorage no longer contains raw provider secrets.
 */
export async function bootstrapStoredApiKeys(): Promise<StoredApiKeys | null> {
  const legacyPlain = readLegacyPlainApiKeys()
  await initCryptoForApiKey(legacyPlain?.anthropic || SERVER_PROVIDED_API_KEY)

  if (legacyPlain) {
    await saveApiKeys(legacyPlain)
    return legacyPlain
  }

  return loadApiKeys()
}
