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

  // Re-sync the hook state when the in-memory Google caches are populated
  // by `bootstrapGoogleStorage()`. On a fresh page refresh, the hook's
  // state initializers run BEFORE async crypto init + decryption finishes,
  // so `getStoredTokens()` returns null and `isConnected` is stuck on
  // false even though the user has valid encrypted tokens at rest.
  // Listen to the 'google-storage-ready' event dispatched at the end of
  // bootstrap to refresh state once the caches are ready.
  useEffect(() => {
    const sync = () => {
      const tokens = getStoredTokens()
      const nextConnected = tokens !== null
      setIsConnected((prev) => (prev === nextConnected ? prev : nextConnected))
      const storedUser = getStoredUser()
      setUser((prev) => {
        if (prev === storedUser) return prev
        if (!prev && !storedUser) return prev
        return storedUser
      })
    }
    // Run once on mount in case bootstrap already finished before this
    // hook mounted (e.g. late-mounted sub-tree).
    sync()
    window.addEventListener('google-storage-ready', sync)
    return () => window.removeEventListener('google-storage-ready', sync)
  }, [])

  // Check token validity on mount (refresh stale access tokens).
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
      try {
        setIsLoading(true)
        const result = await GoogleSignInNative.signIn()

        // Exchange serverAuthCode for real Google tokens
        let accessToken = ''
        let refreshToken = ''
        let expiresIn = 3600

        if (result.serverAuthCode) {
          try {
            const { apiUrl } = await import('../services/apiBase')
            const res = await fetch(apiUrl('/api/auth/token'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: result.serverAuthCode, redirect_uri: '' }),
            })
            if (res.ok) {
              const data = await res.json()
              accessToken = data.access_token || ''
              refreshToken = data.refresh_token || ''
              expiresIn = data.expires_in || 3600
            }
          } catch {
            // Token exchange failed — continue without real tokens
          }
        }

        scoped.setJSON('google-tokens', {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: Date.now() + expiresIn * 1000,
        })

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
