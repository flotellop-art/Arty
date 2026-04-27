import type { GoogleTokens, GoogleUser } from '../types/google'
import { safeJson } from '../utils/safeJson'
import * as scoped from './scopedStorage'
import { apiUrl } from './apiBase'
import { encrypt, decrypt, isCryptoReady, selfTestCrypto } from './crypto'

const FETCH_TIMEOUT_MS = 15_000

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
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

export function buildOAuthUrl(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID manquant')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const t = withTimeout(FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(apiUrl('/api/auth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: getRedirectUri() }),
      signal: t.signal,
    })
  } finally {
    t.cancel()
  }

  const data = await safeJson(res)
  if (!res.ok) throw new Error((data.error as string) || 'Token exchange failed')

  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
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

async function storeUser(user: GoogleUser): Promise<void> {
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
  if (!tokens?.refresh_token) return null

  // BUG 47 — only call logout() on a definitive `invalid_grant` from Google
  // (refresh_token revoked). A transient 5xx, network blip, Cloudflare
  // cold-start, or 15s timeout used to wipe the user's tokens, forcing them
  // to re-login after every long idle. Now we keep tokens on transient
  // errors and let the user retry.
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
    const errCode = typeof data?.error === 'string' ? data.error : ''
    if (res.status === 400 && errCode === 'invalid_grant') {
      console.warn('[googleAuth] refresh_token revoked by Google, logging out')
      logout()
      return null
    }
    console.warn('[googleAuth] refresh transient failure, keeping tokens. status=', res.status, 'error=', errCode)
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

  // Refresh if expiring within 5 minutes
  if (tokens.expires_at - Date.now() < 5 * 60 * 1000) {
    tokens = await refreshAccessToken()
    if (!tokens) return null
  }

  return tokens.access_token
}

export async function fetchGoogleUser(accessToken: string): Promise<GoogleUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

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
}

export function isConnected(): boolean {
  return getStoredTokens() !== null
}
