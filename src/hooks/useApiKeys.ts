import { useState, useCallback, useEffect } from 'react'
import { secureGet, secureSet, initCrypto, isCryptoReady, verifyCrypto } from '../services/crypto'

const KEYS_STORAGE = 'arty-api-keys'

export interface ApiKeys {
  anthropic: string
  gemini?: string
  mistral?: string
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

    // Check if we have a key stored — try reading the raw localStorage first
    const raw = localStorage.getItem(KEYS_STORAGE)
    if (!raw) {
      setLoading(false)
      return
    }

    // Data exists — try to read it
    // We need the crypto key first. Try plain JSON (unencrypted legacy)
    try {
      const parsed = JSON.parse(raw) as ApiKeys
      if (parsed.anthropic) {
        // Legacy unencrypted — migrate
        await initCrypto(parsed.anthropic)
        await secureSet(KEYS_STORAGE, parsed)
        setKeys(parsed)
        setLoading(false)
        return
      }
    } catch {
      // Encrypted data — we need the user to re-enter their key to unlock
    }

    setLoading(false)
  }

  const saveKeys = useCallback(async (newKeys: ApiKeys) => {
    await initCrypto(newKeys.anthropic)
    await secureSet(KEYS_STORAGE, newKeys)
    setKeys(newKeys)
  }, [])

  const unlockWithKey = useCallback(async (anthropicKey: string): Promise<boolean> => {
    const valid = await verifyCrypto(anthropicKey)
    if (valid) {
      await initCrypto(anthropicKey)
      const stored = await secureGet<ApiKeys>(KEYS_STORAGE)
      if (stored) {
        setKeys(stored)
        return true
      }
    }
    return false
  }, [])

  const clearKeys = useCallback(() => {
    localStorage.removeItem(KEYS_STORAGE)
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
