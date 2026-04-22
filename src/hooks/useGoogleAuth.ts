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
      setIsLoading(true)
      setError(null)
      try {
        const result = await GoogleSignInNative.signIn()

        // Without a serverAuthCode we can't obtain refresh + access tokens,
        // so the "connection" would be useless. Fail loud instead of storing
        // empty tokens and silently marking isConnected = true.
        if (!result.serverAuthCode) {
          throw new Error(
            'Google n\'a pas renvoyé de serverAuthCode — réessaye, ou vérifie que GoogleSignInOptions.requestServerAuthCode est bien configuré.',
          )
        }

        const { apiUrl } = await import('../services/apiBase')
        const res = await fetch(apiUrl('/api/auth/token'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: result.serverAuthCode, redirect_uri: '' }),
        })

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '')
          let msg = `Échange de token Google échoué (${res.status})`
          try {
            const parsed = JSON.parse(bodyText) as { error?: string | { message?: string } }
            if (typeof parsed.error === 'string') msg = parsed.error
            else if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) msg = parsed.error.message
          } catch { /* keep default */ }
          throw new Error(msg)
        }

        const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
        if (!data.access_token) {
          throw new Error('Réponse Google sans access_token — retenter la connexion.')
        }

        scoped.setJSON('google-tokens', {
          access_token: data.access_token,
          refresh_token: data.refresh_token || '',
          expires_at: Date.now() + (data.expires_in || 3600) * 1000,
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
        console.error('[useGoogleAuth] native login failed:', err)
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
