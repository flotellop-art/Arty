import type { GoogleTokens, GoogleUser } from '../types/google'
import { safeJson } from '../utils/safeJson'
import * as scoped from './scopedStorage'
import { apiUrl } from './apiBase'
import { encrypt, decrypt, isCryptoReady, selfTestCrypto } from './crypto'

const FETCH_TIMEOUT_MS = 15_000

export function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(id) }
}

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')

// ─────────────────────────────────────────────────────────────
// In-memory cache for encrypted tokens.
// Rationale (see CLAUDE.md BUG 1): sync readers like `getStoredTokens()`
// can't decrypt in a Promise. We cache decrypted tokens in memory so they
// remain sync-accessible, while at rest they are stored AES-256 encrypted
// under `google-tokens-enc`. Legacy plain JSON at `google-tokens` is
// migrated automatically by `bootstrapGoogleStorage()` after crypto is ready.
// ─────────────────────────────────────────────────────────────
let memTokens: GoogleTokens | null = null
let memUser: GoogleUser | null = null

const TOKENS_PLAIN_KEY = 'google-tokens'
const TOKENS_ENC_KEY = 'google-tokens-enc'
const USER_PLAIN_KEY = 'google-user'
const USER_ENC_KEY = 'google-user-enc'

export function getRedirectUri(): string {
  if (import.meta.env.VITE_GOOGLE_REDIRECT_URI) return import.meta.env.VITE_GOOGLE_REDIRECT_URI
  // On native, origin is https://localhost — use Cloudflare URL instead
  if (window.location.origin.includes('localhost')) return 'https://appfacade.pages.dev/auth/callback'
  return `${window.location.origin}/auth/callback`
}

// ─────────────────────────────────────────────────────────────
// OAuth `state` (CSRF protection)
// Random nonce sent to Google with the auth request and verified at the
// callback. Prevents an attacker from forging a `/auth/callback?code=…`
// request that injects their account into the user's session, or from
// replaying a stolen code in a different browser context. Stored in
// `sessionStorage` (same pattern as the BUG 24 fix for `pendingAuth`),
// because React state is destroyed by the OAuth redirect round-trip.
// ─────────────────────────────────────────────────────────────
const OAUTH_STATE_KEY = 'arty-oauth-state'

function generateOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Single-use verification of the `state` parameter returned by Google.
 * Always clears the stored state to prevent replay, even on failure.
 * Returns false if no state was stored (= we never started a web OAuth
 * flow via `buildOAuthUrl`) or if the values don't match.
 */
export function verifyOAuthState(received: string | null | undefined): boolean {
  let expected: string | null = null
  try { expected = sessionStorage.getItem(OAUTH_STATE_KEY) } catch {}
  try { sessionStorage.removeItem(OAUTH_STATE_KEY) } catch {}
  if (!expected || !received) return false
  return expected === received
}

/** Defensive cleanup: drops any pending OAuth state. Called at LoginScreen
 * mount and at logout to avoid stale state breaking the next attempt. */
export function clearOAuthState(): void {
  try { sessionStorage.removeItem(OAUTH_STATE_KEY) } catch {}
}

export function buildOAuthUrl(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID manquant')

  const state = generateOAuthState()
  try { sessionStorage.setItem(OAUTH_STATE_KEY, state) } catch {}

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string, redirectUriOverride?: string): Promise<GoogleTokens> {
  // Native Google Sign-In returns a serverAuthCode that must be exchanged
  // with redirect_uri='' (BUG 2/28); web codes use getRedirectUri(). The
  // override can legitimately be '' — test `=== undefined`, not falsiness.
  const redirectUri = redirectUriOverride !== undefined ? redirectUriOverride : getRedirectUri()
  const t = withTimeout(FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(apiUrl('/api/auth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
      signal: t.signal,
    })
  } finally {
    t.cancel()
  }

  const data = await safeJson(res)
  if (!res.ok) throw new Error((data.error as string) || 'Token exchange failed')

  // BUG 49 — préserver le refresh_token existant si Google n'en renvoie pas
  // (re-consent récent). Sans ça, le refresh_token valide se ferait écraser
  // par undefined → logout silencieux après expiration de l'access_token.
  const existing = getStoredTokens()
  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || existing?.refresh_token || '',
    expires_at: Date.now() + data.expires_in * 1000,
  }

  await storeTokens(tokens)
  return tokens
}

export async function storeTokens(tokens: GoogleTokens): Promise<void> {
  memTokens = tokens
  if (isCryptoReady()) {
    try {
      const encrypted = await encrypt(JSON.stringify(tokens))
      scoped.setItem(TOKENS_ENC_KEY, encrypted)
      scoped.removeItem(TOKENS_PLAIN_KEY) // drop legacy plain copy
      return
    } catch {
      // fall through to plain storage
    }
  }
  // Crypto not ready yet — write plain JSON so sync reads still work.
  // Will be re-encrypted at the next `bootstrapGoogleStorage()` call.
  scoped.setJSON(TOKENS_PLAIN_KEY, tokens)
}

export async function storeUser(user: GoogleUser): Promise<void> {
  memUser = user
  if (isCryptoReady()) {
    try {
      const encrypted = await encrypt(JSON.stringify(user))
      scoped.setItem(USER_ENC_KEY, encrypted)
      scoped.removeItem(USER_PLAIN_KEY)
      return
    } catch {
      // fall through
    }
  }
  scoped.setJSON(USER_PLAIN_KEY, user)
}

export async function refreshAccessToken(): Promise<GoogleTokens | null> {
  const tokens = getStoredTokens()
  // No refresh_token in storage = the only path forward is re-login. Wipe
  // and surface as "disconnected" so the UI shows "Connecter Google"
  // instead of leaving the user stuck on stale tokens that can never
  // refresh (BUG 48 — happened when Google didn't re-issue a
  // refresh_token on a re-auth where the user had recently consented).
  if (!tokens?.refresh_token) {
    if (tokens) {
      console.warn('[googleAuth] no refresh_token in storage, logging out')
      logout()
    }
    return null
  }

  // BUG 47/48 — distinguish definitive auth failures (refresh_token
  // revoked or invalid) from transient errors using the HTTP status
  // ONLY. The proxy at functions/api/auth/refresh.ts overwrites
  // Google's `error: "invalid_grant"` body with the `error_description`
  // string ("Token has been expired or revoked."), so a body-content
  // check fails to detect revocation. Status-based detection is robust:
  //  - 4xx from /api/auth/refresh = the refresh_token is bad → logout
  //  - 5xx or network/timeout = transient → keep tokens, return null
  const t = withTimeout(FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      signal: t.signal,
    })
  } catch (err) {
    console.warn('[googleAuth] refresh fetch failed (network/timeout, keeping tokens):', err)
    return null
  } finally {
    t.cancel()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any
  try {
    data = await safeJson(res)
  } catch (err) {
    console.warn('[googleAuth] refresh response unreadable, keeping tokens. status=', res.status, err)
    return null
  }

  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      // 4xx from the refresh proxy = Google rejected the refresh_token
      // (revoked, expired, or never valid). Logout so the UI offers a
      // "Connecter Google" CTA instead of looping on stale tokens.
      console.warn('[googleAuth] refresh definitively rejected, logging out. status=', res.status, 'body=', data)
      logout()
      return null
    }
    console.warn('[googleAuth] refresh transient failure, keeping tokens. status=', res.status)
    return null
  }

  const updated: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }

  await storeTokens(updated)
  return updated
}

export async function getValidAccessToken(): Promise<string | null> {
  let tokens = getStoredTokens()
  if (!tokens) return null

  // Ignore placeholder/fake tokens
  if (!tokens.access_token || tokens.access_token === 'native') return null

  // Refresh if expiring within 5 minutes. Retry up to 3 times with backoff
  // (0s, 1.5s, 3s) to ride out Cloudflare/network blips on cold-resume —
  // typical scenario: app comes back from background after >1h, mobile
  // radio re-warms (~1-3s), first refresh attempt fails, second succeeds.
  // Stop early if the refresh path called logout() (= invalid_grant, tokens
  // wiped definitively).
  if (tokens.expires_at - Date.now() < 5 * 60 * 1000) {
    const delays = [0, 1500, 3000]
    for (const delay of delays) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      tokens = await refreshAccessToken()
      if (tokens) break
      if (!getStoredTokens()) return null // logout() was called → give up
    }
    if (!tokens) {
      console.warn('[googleAuth] refresh failed after retries, keeping tokens for next attempt')
      return null
    }
  }

  return tokens.access_token
}

export async function fetchGoogleUser(accessToken: string): Promise<GoogleUser> {
  const t = withTimeout(FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: t.signal,
    })
  } finally {
    t.cancel()
  }

  if (!res.ok) throw new Error('Failed to fetch user info')
  const data = await safeJson(res)

  const user: GoogleUser = {
    email: data.email,
    name: data.name,
    picture: data.picture,
  }

  await storeUser(user)
  return user
}

/**
 * Synchronous read of the current Google tokens.
 * Returns the in-memory cache if populated (after boot decryption), or the
 * legacy plain-JSON copy for unmigrated data. Returns null if not connected.
 */
export function getStoredTokens(): GoogleTokens | null {
  if (memTokens) return memTokens
  const legacy = scoped.getJSON<GoogleTokens>(TOKENS_PLAIN_KEY)
  if (legacy) memTokens = legacy
  return legacy
}

export function getStoredUser(): GoogleUser | null {
  if (memUser) return memUser
  const legacy = scoped.getJSON<GoogleUser>(USER_PLAIN_KEY)
  if (legacy) memUser = legacy
  return legacy
}

/**
 * Decrypt Google tokens/user from localStorage into the in-memory cache, and
 * migrate any legacy plain-JSON copies to encrypted storage. Must be called
 * after `initCrypto()` succeeds — safe to call multiple times.
 *
 * Self-heals (BUG 43): if an encrypted blob can't be decrypted (typically
 * because the user's passphrase changed between sessions — sk-ant-xxx →
 * 'server-provided' or vice versa, or a crypto salt rotation), we WIPE the
 * corrupt blob instead of leaving it in place. Leaving it caused "Google
 * disconnected after update" — the app refused to dispatch the ready event
 * and the user had to clear app data to escape the stale ciphertext.
 */
export async function bootstrapGoogleStorage(): Promise<void> {
  if (!isCryptoReady()) return

  try {
    // Tokens
    const encTokens = scoped.getItem(TOKENS_ENC_KEY)
    if (encTokens) {
      try {
        memTokens = JSON.parse(await decrypt(encTokens)) as GoogleTokens
      } catch (err) {
        // BUG 47 — distinguish "blob genuinely corrupt" (key OK, decrypt
        // fails) from "wrong passphrase loaded" (key mismatch). Only wipe
        // in the first case. The second happens transiently on cold boot
        // when initCrypto runs with a stale or wrong api-keys snapshot,
        // and used to force-relogin after every APK update.
        const keyOk = await selfTestCrypto()
        if (keyOk) {
          console.warn('[googleAuth] tokens ciphertext corrupt (key self-test passed), wiping:', err)
          scoped.removeItem(TOKENS_ENC_KEY)
          memTokens = null
        } else {
          console.warn('[googleAuth] tokens decrypt failed AND key self-test failed → keeping blob, expecting passphrase fix:', err)
        }
      }
    } else {
      const plain = scoped.getJSON<GoogleTokens>(TOKENS_PLAIN_KEY)
      if (plain) {
        memTokens = plain
        await storeTokens(plain) // re-encrypt & drop plain
      }
    }

    // User
    const encUser = scoped.getItem(USER_ENC_KEY)
    if (encUser) {
      try {
        memUser = JSON.parse(await decrypt(encUser)) as GoogleUser
      } catch (err) {
        const keyOk = await selfTestCrypto()
        if (keyOk) {
          console.warn('[googleAuth] user ciphertext corrupt (key self-test passed), wiping:', err)
          scoped.removeItem(USER_ENC_KEY)
          memUser = null
        } else {
          console.warn('[googleAuth] user decrypt failed AND key self-test failed → keeping blob:', err)
        }
      }
    } else {
      const plain = scoped.getJSON<GoogleUser>(USER_PLAIN_KEY)
      if (plain) {
        memUser = plain
        await storeUser(plain)
      }
    }
  } finally {
    // ALWAYS dispatch so the UI never stays stuck waiting — even if the
    // bootstrap threw halfway. Without the finally, a mid-bootstrap crash
    // left subscribers (useGoogleAuth, InputBar) thinking Google was still
    // initialising, hiding the login button forever.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('google-storage-ready'))
    }
  }
}

export function logout(): void {
  memTokens = null
  memUser = null
  scoped.removeItem(TOKENS_PLAIN_KEY)
  scoped.removeItem(TOKENS_ENC_KEY)
  scoped.removeItem(USER_PLAIN_KEY)
  scoped.removeItem(USER_ENC_KEY)
  // Notify subscribers (useGoogleAuth) so the UI re-renders to "Connecter
  // Google" without waiting for a manual refresh. Critical when logout()
  // is called from inside refreshAccessToken() on a 4xx — the user has
  // AGENDA open, the refresh fails, tokens are wiped, and without this
  // dispatch the hook's `isConnected` state stays stale until next mount.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('google-storage-ready'))
  }
}

/**
 * Drop the in-memory token/user cache WITHOUT touching localStorage.
 * Used on account switch: memTokens/memUser are module-level, so they
 * would otherwise keep the previous account's data — and leak it to sync
 * readers (getStoredTokens) — until bootstrapGoogleStorage() repopulates.
 */
export function resetGoogleMemCache(): void {
  memTokens = null
  memUser = null
}

export function isConnected(): boolean {
  return getStoredTokens() !== null
}
