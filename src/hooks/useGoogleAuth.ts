import { useState, useEffect, useCallback } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
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
import * as scoped from '../services/scopedStorage'
import { apiUrl } from '../services/apiBase'

interface GoogleSignInNativePlugin {
  signIn(): Promise<{ email: string; name: string; avatar: string; serverAuthCode: string }>
  signOut(): Promise<void>
}
const GoogleSignInNative = registerPlugin<GoogleSignInNativePlugin>('GoogleSignInNative')

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

  const login = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      // Native: use Google Sign-In SDK (popup natif)
      try {
        setIsLoading(true)
        const result = await GoogleSignInNative.signIn()

        // Exchange serverAuthCode for access+refresh tokens
        const res = await fetch(apiUrl('/api/auth/token'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: result.serverAuthCode, redirect_uri: '' }),
        })
        const tokens = await res.json()

        if (tokens.access_token) {
          scoped.setJSON('google-tokens', {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || '',
            expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
          })
        }

        const googleUser: GoogleUser = {
          email: result.email,
          name: result.name || result.email?.split('@')[0] || '',
          picture: result.avatar || '',
        }
        scoped.setJSON('google-user', googleUser)
        setUser(googleUser)
        setIsConnected(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur Google Sign-In')
      } finally {
        setIsLoading(false)
      }
    } else {
      // Web: redirect OAuth
      try {
        const url = buildOAuthUrl()
        window.location.href = url
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur connexion Google')
      }
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
