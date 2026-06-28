import { useState, useCallback, useEffect } from 'react'
import { isCryptoReady } from '../services/crypto'
import { initCryptoForApiKey } from '../services/cryptoPassphrase'
import { loadApiKeys, saveApiKeys, clearApiKeys, readLegacyPlainApiKeys } from '../services/apiKeyStorage'

export interface ApiKeys {
  anthropic: string
  gemini?: string
  mistral?: string
  openai?: string
}

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKeys | null>(null)
  const [loading, setLoading] = useState(true)

  // Try to load keys on mount
  useEffect(() => {
    loadKeys()
  }, [])

  async function loadKeys() {
    setLoading(true)
    try {
      const legacy = readLegacyPlainApiKeys()
      if (legacy?.anthropic) {
        await initCryptoForApiKey(legacy.anthropic)
        await saveApiKeys(legacy)
        setKeys(legacy)
        return
      }

      const stored = await loadApiKeys()
      setKeys(stored)
    } finally {
      setLoading(false)
    }
  }

  const saveKeys = useCallback(async (newKeys: ApiKeys) => {
    await initCryptoForApiKey(newKeys.anthropic)
    await saveApiKeys(newKeys)
    setKeys(newKeys)
  }, [])

  const unlockWithKey = useCallback(async (anthropicKey: string): Promise<boolean> => {
    await initCryptoForApiKey(anthropicKey)
    const stored = await loadApiKeys()
    if (stored) {
      setKeys(stored)
      return true
    }
    return false
  }, [])

  const clearKeys = useCallback(() => {
    clearApiKeys()
    setKeys(null)
  }, [])

  return {
    keys,
    loading,
    isReady: keys !== null && isCryptoReady(),
    saveKeys,
    unlockWithKey,
    clearKeys,
  }
}
