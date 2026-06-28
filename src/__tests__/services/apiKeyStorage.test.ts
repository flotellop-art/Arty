import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => 'user-test',
}))

import { initCryptoForApiKey } from '../../services/cryptoPassphrase'
import {
  API_KEYS_STORAGE_KEY,
  bootstrapStoredApiKeys,
  loadApiKeys,
  readLegacyPlainApiKeys,
  saveApiKeys,
} from '../../services/apiKeyStorage'
import { getStorageKey } from '../../services/scopedStorage'

const keys = {
  anthropic: 'sk-ant-live-secret',
  gemini: 'AIza-gemini-secret',
  mistral: 'mistral-secret',
  openai: 'sk-openai-secret',
}

describe('apiKeyStorage encrypted BYOK storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stores provider API keys encrypted, not as raw localStorage JSON', async () => {
    await initCryptoForApiKey(keys.anthropic)
    await saveApiKeys(keys)

    const raw = localStorage.getItem(getStorageKey(API_KEYS_STORAGE_KEY))
    expect(raw).toBeTruthy()
    expect(raw).not.toContain(keys.anthropic)
    expect(raw).not.toContain(keys.gemini)
    expect(() => JSON.parse(raw!)).toThrow()
    await expect(loadApiKeys()).resolves.toEqual(keys)
  })

  it('migrates legacy plaintext api-keys and removes raw provider secrets from storage', async () => {
    localStorage.setItem(getStorageKey(API_KEYS_STORAGE_KEY), JSON.stringify(keys))
    expect(readLegacyPlainApiKeys()).toEqual(keys)

    await expect(bootstrapStoredApiKeys()).resolves.toEqual(keys)

    const raw = localStorage.getItem(getStorageKey(API_KEYS_STORAGE_KEY))
    expect(raw).toBeTruthy()
    expect(raw).not.toContain(keys.anthropic)
    expect(raw).not.toContain(keys.openai)
    expect(readLegacyPlainApiKeys()).toBeNull()
    await expect(loadApiKeys()).resolves.toEqual(keys)
  })
})
