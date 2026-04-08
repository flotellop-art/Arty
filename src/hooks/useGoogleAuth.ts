import { useState, useEffect, useCallback } from 'react'
import type { GoogleUser } from '../types/google'
import {
  buildOAuthUrl,
  exchangeCode,
  fetchGoogleUser,
  getStoredTokens,
  getStoredUser,
  getValidAccessToken,
  logout as googleLogout,
} from '../services/googleAuth'

export function useGoogleAuth() {
  const [user, setUser] = useState<GoogleUser | null>(() => getStoredUser())
  const [isConnected, setIsConnected] = useState(() => getStoredTokens() !== null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check token validity on mount
  useEffect(() => {
    if (!isConnected) return
    getValidAccessToken().then((token) => {
      if (!token) {
        setIsConnected(false)
        setUser(null)
      }
    })
  }, [isConnected])

  const login = useCallback(() => {
    try {
      const url = buildOAuthUrl()
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur connexion Google')
    }
  }, [])

  const handleCallback = useCallback(async (code: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const tokens = await exchangeCode(code)
      const googleUser = await fetchGoogleUser(tokens.access_token)
      setUser(googleUser)
      setIsConnected(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur authentification')
      setIsConnected(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    googleLogout()
    setUser(null)
    setIsConnected(false)
    setError(null)
  }, [])

  return {
    user,
    isConnected,
    isLoading,
    error,
    login,
    handleCallback,
    logout,
  }
}
