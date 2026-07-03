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
  storeUser,
  logout as googleLogout,
} from '../services/googleAuth'

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
  // We DO NOT setIsConnected(false) on transient null — BUG 47 made the
  // refresh resilient (no wipe on 5xx), so a null here usually means a
  // temporary network blip, not a real disconnect. Flipping isConnected
  // would force the user back to the login screen for nothing. The hook
  // stays "connected" while tokens exist in storage; AGENDA/Gmail will
  // show their own retryable error if the immediate API call fails.
  useEffect(() => {
    if (!isConnected) return
    getValidAccessToken().catch(() => {})
  }, [isConnected])

  // Proactive refresh every 30 min while the app is in the foreground.
  // Google access_token expires in 1h, so refreshing twice within that
  // window means the user's session is always fresh — no surprise
  // "Non connecté à Google" when they tap on AGENDA after a long browse.
  useEffect(() => {
    if (!isConnected) return
    const id = window.setInterval(() => {
      getValidAccessToken().catch(() => {})
    }, 30 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [isConnected])

  // Refresh on app resume. When the user comes back from another app
  // after >1h, the stored access_token is expired. Without this, the
  // FIRST API call (AGENDA mount, Gmail fetch) hits the cold-start
  // window and throws "Non connecté à Google" before the user can do
  // anything. Triggering the refresh here means the cold-start delay
  // happens silently while the user is still looking at the home screen.
  // On native we use Capacitor App.appStateChange; on web we fall back
  // to the document visibility API.
  useEffect(() => {
    if (!isConnected) return
    let cleanupNative: (() => void) | undefined

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        getValidAccessToken().catch(() => {})
      }
    }

    if (Capacitor.isNativePlatform()) {
      ;(async () => {
        try {
          const { App: CapApp } = await import('@capacitor/app')
          const sub = await CapApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive) getValidAccessToken().catch(() => {})
          })
          cleanupNative = () => sub.remove()
        } catch { /* fall back to visibilitychange below */ }
      })()
    } else {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      if (cleanupNative) cleanupNative()
      else document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isConnected])

  const login = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      // Étape 13 audit — debug logs gated DEV pour éviter de leaker des emails
      // dans la console prod (PII soft). console.error reste actif (utile en prod).
      if (import.meta.env.DEV) console.log('[useGoogleAuth] login() called — native path')
      setIsLoading(true)
      setError(null)
      try {
        // 30s watchdog — if the native plugin's pendingCall is orphaned
        // (activity recycled during the Google popup, a common Android
        // lifecycle race), signIn() would hang forever. Surface a real
        // error instead of spinning indefinitely.
        if (import.meta.env.DEV) console.log('[useGoogleAuth] calling GoogleSignInNative.signIn()...')
        const timeoutMs = 30_000
        const result = await Promise.race([
          GoogleSignInNative.signIn(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Timeout Google (${timeoutMs / 1000}s) — le plugin natif n'a pas répondu. Réessaye ou redémarre l'app.`)),
              timeoutMs,
            ),
          ),
        ])
        if (import.meta.env.DEV) console.log('[useGoogleAuth] signIn resolved:', {
          hasEmail: !!result.email,
          hasServerAuthCode: !!result.serverAuthCode,
          serverAuthCodeLen: result.serverAuthCode?.length || 0,
        })

        // Without a serverAuthCode we can't obtain refresh + access tokens,
        // so the "connection" would be useless. Fail loud instead of storing
        // empty tokens and silently marking isConnected = true.
        if (!result.serverAuthCode) {
          throw new Error(
            'Google n\'a pas renvoyé de serverAuthCode — réessaye, ou vérifie que GoogleSignInOptions.requestServerAuthCode est bien configuré.',
          )
        }

        if (import.meta.env.DEV) console.log('[useGoogleAuth] exchanging code for tokens...')
        // Native serverAuthCode → exchange via the shared exchangeCode():
        // gives the 15s timeout, refresh_token preservation (BUG 49) and
        // encrypted-at-rest storage. redirect_uri MUST be '' for a native
        // serverAuthCode (BUG 2/28). exchangeCode throws on failure → the
        // catch below surfaces the error instead of a silent broken session.
        await exchangeCode(result.serverAuthCode, '')

        const googleUser: GoogleUser = {
          email: result.email,
          name: result.name || result.email?.split('@')[0] || '',
          picture: result.avatar || '',
        }
        await storeUser(googleUser)
        setUser(googleUser)
        setIsConnected(true)
        if (import.meta.env.DEV) console.log('[useGoogleAuth] login success for', result.email)
      } catch (err) {
        console.error('[useGoogleAuth] native login failed:', err)
        setError(err instanceof Error ? err.message : 'Erreur Google Sign-In')
      } finally {
        setIsLoading(false)
      }
    } else {
      // Web: redirect OAuth
      try {
        const url = await buildOAuthUrl()
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
