import type { GoogleTokens, GoogleUser } from '../types/google'
import { safeJson } from '../utils/safeJson'
import * as scoped from './scopedStorage'
import { apiUrl } from './apiBase'
import { encrypt, decrypt, isCryptoReady, selfTestCrypto } from './crypto'
import { getActiveUserId } from './userSession'

const FETCH_TIMEOUT_MS = 15_000

export function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(id) }
}

// Public-client profile: Calendar remains available. Contextual Gmail scopes
// live only in the isolated Workspace Add-on manifest and never appear here.
export const PUBLIC_GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events',
]
export const CURRENT_GOOGLE_OAUTH_PROFILE = 'calendar-events-v1' as const

export function getGoogleOAuthScopes(): string[] {
  return [...PUBLIC_GOOGLE_SCOPES]
}

const SCOPES = getGoogleOAuthScopes().join(' ')

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
let googleStorageReady = false
// Monotonic guard for async token writes. A refresh or encryption that
// completes after logout/profile migration must never restore stale tokens.
let tokenStorageGeneration = 0
let userStorageGeneration = 0

const TOKENS_PLAIN_KEY = 'google-tokens'
const TOKENS_ENC_KEY = 'google-tokens-enc'
const USER_PLAIN_KEY = 'google-user'
const USER_ENC_KEY = 'google-user-enc'
// One-time OAuth epoch. Existing installs may hold refresh tokens issued before
// mailbox access was removed. We revoke and purge that grant once, then require
// a fresh sign-in with the reduced scopes above.
const MAILBOX_FREE_OAUTH_EPOCH_KEY = 'google-oauth-mailbox-free-v1'
const GOOGLE_OAUTH_RECONSENT_KEY = 'google-oauth-reconsent-required'

async function revokeLegacyGoogleGrant(token: string): Promise<void> {
  if (!token || token === 'native') return
  const t = withTimeout(5_000)
  try {
    const response = await fetch(apiUrl('/api/auth/revoke'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: t.signal,
    })
    if (!response.ok) throw new Error('Google revocation failed')
  } catch {
    // Best effort only. Local credentials are already purged, so the app can
    // no longer refresh or use the old grant even if Google is unreachable.
  } finally {
    t.cancel()
  }
}

export function isGoogleOAuthReconsentRequired(): boolean {
  return scoped.getItem(GOOGLE_OAUTH_RECONSENT_KEY) === CURRENT_GOOGLE_OAUTH_PROFILE
}

export function isGoogleStorageReady(): boolean {
  return googleStorageReady
}

async function migrateLegacyGrantForEpoch(epochKey: string): Promise<boolean> {
  if (scoped.getItem(epochKey) === '1') return false

  // A retained encrypted blob with no decrypted cache means the crypto key is
  // temporarily unavailable. Do not mark the epoch complete: retry next boot.
  if (scoped.getItem(TOKENS_ENC_KEY) && !memTokens) return false

  scoped.setItem(epochKey, '1')
  const tokens = getStoredTokens()
  if (!tokens) return false

  const tokenToRevoke = tokens.refresh_token || tokens.access_token
  scoped.setItem(GOOGLE_OAUTH_RECONSENT_KEY, CURRENT_GOOGLE_OAUTH_PROFILE)
  // Keep subscribers quiet until bounded revocation + native cache cleanup
  // finish. bootstrapGoogleStorage publishes one coherent ready event after.
  logout({ preserveReconsent: true, notify: false })
  // The same-origin server bridge is the single revocation authority. Do not
  // launch a native Google Task here: a late Task completion could invalidate
  // the fresh grant after the reconnect CTA becomes available.
  await revokeLegacyGoogleGrant(tokenToRevoke)
  return true
}

export async function migrateLegacyMailboxGrant(): Promise<boolean> {
  if (scoped.getItem(MAILBOX_FREE_OAUTH_EPOCH_KEY) === '1') return false
  // calendar-events-v1 is server-proven exact and therefore mailbox-free.
  // If its marker write was interrupted after the token commit, self-heal the
  // old marker instead of revoking a known-current grant.
  if (getStoredTokens()?.oauth_profile === CURRENT_GOOGLE_OAUTH_PROFILE) {
    scoped.setItem(MAILBOX_FREE_OAUTH_EPOCH_KEY, '1')
    return false
  }
  return migrateLegacyGrantForEpoch(MAILBOX_FREE_OAUTH_EPOCH_KEY)
}

export async function migrateLegacyCalendarGrant(): Promise<boolean> {
  // The profile travels atomically inside the encrypted token blob. A missing
  // field is a legacy broad-Calendar grant, including after an app downgrade.
  const tokens = getStoredTokens()
  if (!tokens || tokens.oauth_profile === CURRENT_GOOGLE_OAUTH_PROFILE) return false
  const tokenToRevoke = tokens.refresh_token || tokens.access_token
  scoped.setItem(GOOGLE_OAUTH_RECONSENT_KEY, CURRENT_GOOGLE_OAUTH_PROFILE)
  logout({ preserveReconsent: true, notify: false })
  await revokeLegacyGoogleGrant(tokenToRevoke)
  return true
}

export function getRedirectUri(): string {
  // Previews Cloudflare Pages (*.appfacade.pages.dev) : renvoyer sur LEUR propre
  // callback après le login Google. Sinon le VITE_GOOGLE_REDIRECT_URI (épinglé
  // sur le callback prod) renverrait un login lancé depuis une preview vers la
  // prod. Les hosts prod (appfacade.pages.dev, tryarty.com) ne matchent pas le
  // point de tête → ils gardent l'override ci-dessous. ⚠️ l'alias de branche
  // doit être enregistré comme redirect URI dans le client OAuth Google.
  try {
    if (window.location.hostname.endsWith('.appfacade.pages.dev')) {
      return `${window.location.origin}/auth/callback`
    }
  } catch {
    /* pas de window (SSR/test) — on continue */
  }
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

/** base64url sans padding d'un buffer d'octets (URL-safe, RFC 7636). */
function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generateOAuthState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)))
}

// ────────────────────────────────
// PKCE (F-11) — code_verifier / code_challenge (S256)
// Défense contre l'interception du code d'autorisation : Google ne délivre les
// tokens que si l'échange présente le `code_verifier` dont le SHA-256 correspond
// au `code_challenge` envoyé à l'autorisation. Verifier persisté en sessionStorage
// (comme le state — survit au round-trip de redirection, BUG 24), consommé UNE
// seule fois à l'échange. Le flow NATIF (serverAuthCode) n'utilise pas PKCE.
// ────────────────────────────────
const OAUTH_VERIFIER_KEY = 'arty-oauth-verifier'

function generateCodeVerifier(): string {
  // 32 octets → 43 caractères base64url (dans la plage 43-128 de la RFC 7636).
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function computeCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/**
 * Lecture SINGLE-USE du code_verifier PKCE : le renvoie et le supprime dans la
 * foulée (anti-replay + anti-staleness). Un seul point de consommation
 * (exchangeCode, flow web) — même discipline que le `state` (BUG 53).
 */
export function takeCodeVerifier(): string | null {
  let v: string | null = null
  try { v = sessionStorage.getItem(OAUTH_VERIFIER_KEY) } catch {}
  try { sessionStorage.removeItem(OAUTH_VERIFIER_KEY) } catch {}
  return v
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
  try { sessionStorage.removeItem(OAUTH_VERIFIER_KEY) } catch {}
}

export async function buildOAuthUrl(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID manquant')

  const state = generateOAuthState()
  try { sessionStorage.setItem(OAUTH_STATE_KEY, state) } catch {}

  // PKCE (F-11) : générer + persister le verifier, envoyer le challenge S256.
  const verifier = generateCodeVerifier()
  try { sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier) } catch {}
  const codeChallenge = await computeCodeChallenge(verifier)

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    include_granted_scopes: 'false',
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(
  code: string,
  redirectUriOverride?: string,
  persistGrant = true,
): Promise<GoogleTokens> {
  // Native Google Sign-In returns a serverAuthCode that must be exchanged
  // with redirect_uri='' (BUG 2/28); web codes use getRedirectUri(). The
  // override can legitimately be '' — test `=== undefined`, not falsiness.
  const redirectUri = redirectUriOverride !== undefined ? redirectUriOverride : getRedirectUri()
  // PKCE (F-11) : seul le flow WEB (override === undefined) a posé un verifier
  // via buildOAuthUrl. Le consommer (single-use) et le joindre à l'échange. Le
  // flow NATIF (serverAuthCode, override '') n'utilise pas PKCE → pas de verifier.
  const codeVerifier = redirectUriOverride === undefined ? takeCodeVerifier() : null
  const t = withTimeout(FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(apiUrl('/api/auth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        redirect_uri: redirectUri,
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
      signal: t.signal,
    })
  } finally {
    t.cancel()
  }

  const data = await safeJson(res)
  if (!res.ok) {
    if (data.error === 'invalid_scope_set') {
      scoped.setItem(GOOGLE_OAUTH_RECONSENT_KEY, CURRENT_GOOGLE_OAUTH_PROFILE)
      logout({ preserveReconsent: true })
    }
    throw new Error((data.error as string) || 'Token exchange failed')
  }
  if (data.oauth_profile !== CURRENT_GOOGLE_OAUTH_PROFILE) {
    throw new Error('Google OAuth profile was not verified')
  }

  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    expires_at: Date.now() + data.expires_in * 1000,
  }

  // Le callback de première connexion ne connaît l'identité Google qu'après
  // cet échange. Il diffère donc la persistance jusqu'à l'activation du scope
  // utilisateur, sinon le grant et son marqueur d'époque seraient écrits sous
  // la portée globale puis considérés comme legacy au bootstrap suivant.
  return persistGrant ? storeMailboxFreeGrant(tokens) : tokens
}

export async function storeTokens(tokens: GoogleTokens): Promise<boolean> {
  const writeGeneration = ++tokenStorageGeneration
  const ownerAtStart = getActiveUserId()
  const writeStillCurrent = () =>
    writeGeneration === tokenStorageGeneration && ownerAtStart === getActiveUserId()
  const abandonWrite = () => {
    if (writeGeneration === tokenStorageGeneration && memTokens === tokens) memTokens = null
    return false
  }
  memTokens = tokens
  if (isCryptoReady()) {
    try {
      const encrypted = await encrypt(JSON.stringify(tokens))
      if (!writeStillCurrent()) return abandonWrite()
      scoped.setItem(TOKENS_ENC_KEY, encrypted)
      scoped.removeItem(TOKENS_PLAIN_KEY) // drop legacy plain copy
      return true
    } catch {
      if (!writeStillCurrent()) return abandonWrite()
      // fall through to plain storage
    }
  }
  // Crypto not ready yet — write plain JSON so sync reads still work.
  // Will be re-encrypted at the next `bootstrapGoogleStorage()` call.
  if (writeStillCurrent()) {
    scoped.setJSON(TOKENS_PLAIN_KEY, tokens)
    return true
  }
  return abandonWrite()
}

/**
 * Persiste un grant émis avec le profil Google courant, sans accès boîte mail.
 *
 * Google ne renvoie pas toujours un nouveau refresh_token lors d'une
 * reconnexion. Le fallback vers le refresh_token déjà stocké reste utile, mais
 * uniquement si ce stockage appartient déjà à l'époque mailbox-free. Un jeton
 * antérieur à cette époque peut encore porter les anciens scopes Gmail et ne
 * doit jamais être recyclé dans un grant frais.
 */
export async function storeMailboxFreeGrant(tokens: GoogleTokens): Promise<GoogleTokens> {
  const ownerAtStart = getActiveUserId()
  const existingTokens = getStoredTokens()
  const existingRefreshToken = existingTokens?.oauth_profile === CURRENT_GOOGLE_OAUTH_PROFILE
    ? existingTokens.refresh_token
    : ''

  const mailboxFreeTokens: GoogleTokens = {
    ...tokens,
    refresh_token: tokens.refresh_token || existingRefreshToken || '',
    oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
  }

  // Persister d'abord le nouveau grant, puis seulement son marqueur. Si
  // l'écriture ou l'application s'interrompt entre les deux, le bootstrap
  // traitera le grant comme legacy et forcera une reconnexion sûre.
  const committed = await storeTokens(mailboxFreeTokens)
  if (!committed || ownerAtStart !== getActiveUserId()) {
    throw new Error('Google grant storage was superseded')
  }
  scoped.setItem(MAILBOX_FREE_OAUTH_EPOCH_KEY, '1')
  scoped.removeItem(GOOGLE_OAUTH_RECONSENT_KEY)
  return mailboxFreeTokens
}

export async function storeUser(user: GoogleUser): Promise<boolean> {
  const writeGeneration = ++userStorageGeneration
  const ownerAtStart = getActiveUserId()
  const writeStillCurrent = () =>
    writeGeneration === userStorageGeneration && ownerAtStart === getActiveUserId()
  const abandonWrite = () => {
    if (writeGeneration === userStorageGeneration && memUser === user) memUser = null
    return false
  }
  memUser = user
  if (isCryptoReady()) {
    try {
      const encrypted = await encrypt(JSON.stringify(user))
      if (!writeStillCurrent()) return abandonWrite()
      scoped.setItem(USER_ENC_KEY, encrypted)
      scoped.removeItem(USER_PLAIN_KEY)
      return true
    } catch {
      if (!writeStillCurrent()) return abandonWrite()
      // fall through
    }
  }
  if (writeStillCurrent()) {
    scoped.setJSON(USER_PLAIN_KEY, user)
    return true
  }
  return abandonWrite()
}

export async function refreshAccessToken(): Promise<GoogleTokens | null> {
  const tokens = getStoredTokens()
  const refreshGeneration = tokenStorageGeneration
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
      body: JSON.stringify({
        refresh_token: tokens.refresh_token,
        oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
      }),
      signal: t.signal,
    })
  } catch (err) {
    console.warn('[googleAuth] refresh fetch failed (network/timeout, keeping tokens):', err)
    return null
  } finally {
    t.cancel()
  }

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
      // Ne PAS logger le body complet (PII potentielle dans les crash reports) ;
      // le code d'erreur suffit au diagnostic (audit 14 juin).
      console.warn('[googleAuth] refresh definitively rejected, logging out. status=', res.status, 'error=', data?.error)
      if (data?.error === 'invalid_scope_set') {
        scoped.setItem(GOOGLE_OAUTH_RECONSENT_KEY, CURRENT_GOOGLE_OAUTH_PROFILE)
      }
      logout({ preserveReconsent: data?.error === 'invalid_scope_set' })
      return null
    }
    console.warn('[googleAuth] refresh transient failure, keeping tokens. status=', res.status)
    return null
  }

  const updated: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
  }

  if (data.oauth_profile !== CURRENT_GOOGLE_OAUTH_PROFILE) {
    scoped.setItem(GOOGLE_OAUTH_RECONSENT_KEY, CURRENT_GOOGLE_OAUTH_PROFILE)
    logout({ preserveReconsent: true })
    return null
  }

  // A logout, profile migration, fresh login, or newer refresh won the race
  // while this request was in flight. Discard this stale response.
  if (
    refreshGeneration !== tokenStorageGeneration
    || getStoredTokens()?.refresh_token !== tokens.refresh_token
  ) return null

  await storeTokens(updated)
  return getStoredTokens()?.access_token === updated.access_token ? updated : null
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
  const ownerAtStart = getActiveUserId()
  let expectedTokenGeneration = tokenStorageGeneration
  let expectedUserGeneration = userStorageGeneration
  const tokenContextIsCurrent = () =>
    ownerAtStart === getActiveUserId() && expectedTokenGeneration === tokenStorageGeneration
  const userContextIsCurrent = () =>
    ownerAtStart === getActiveUserId() && expectedUserGeneration === userStorageGeneration

  try {
    // Tokens
    const encTokens = scoped.getItem(TOKENS_ENC_KEY)
    if (encTokens) {
      try {
        const decryptedTokens = JSON.parse(await decrypt(encTokens)) as GoogleTokens
        if (!tokenContextIsCurrent()) return
        memTokens = decryptedTokens
      } catch (err) {
        if (!tokenContextIsCurrent()) return
        // BUG 47 — distinguish "blob genuinely corrupt" (key OK, decrypt
        // fails) from "wrong passphrase loaded" (key mismatch). Only wipe
        // in the first case. The second happens transiently on cold boot
        // when initCrypto runs with a stale or wrong api-keys snapshot,
        // and used to force-relogin after every APK update.
        const keyOk = await selfTestCrypto()
        if (!tokenContextIsCurrent()) return
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
        const committed = await storeTokens(plain) // re-encrypt & drop plain
        if (!committed || ownerAtStart !== getActiveUserId()) return
        expectedTokenGeneration = tokenStorageGeneration
      }
    }

    // User
    const encUser = scoped.getItem(USER_ENC_KEY)
    if (encUser) {
      try {
        const decryptedUser = JSON.parse(await decrypt(encUser)) as GoogleUser
        if (!userContextIsCurrent()) return
        memUser = decryptedUser
      } catch (err) {
        if (!userContextIsCurrent()) return
        const keyOk = await selfTestCrypto()
        if (!userContextIsCurrent()) return
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
        const committed = await storeUser(plain)
        if (!committed || ownerAtStart !== getActiveUserId()) return
        expectedUserGeneration = userStorageGeneration
      }
    }

    if (!tokenContextIsCurrent() || !userContextIsCurrent()) return
    const mailboxMigrated = await migrateLegacyMailboxGrant()
    if (ownerAtStart !== getActiveUserId()) return
    if (mailboxMigrated) {
      if (
        tokenStorageGeneration !== expectedTokenGeneration + 1
        || userStorageGeneration !== expectedUserGeneration + 1
      ) return
      expectedTokenGeneration = tokenStorageGeneration
      expectedUserGeneration = userStorageGeneration
    } else if (!tokenContextIsCurrent() || !userContextIsCurrent()) {
      return
    }

    await migrateLegacyCalendarGrant()
  } finally {
    // ALWAYS dispatch so the UI never stays stuck waiting — even if the
    // bootstrap threw halfway. Without the finally, a mid-bootstrap crash
    // left subscribers (useGoogleAuth, InputBar) thinking Google was still
    // initialising, hiding the login button forever.
    if (ownerAtStart === getActiveUserId()) googleStorageReady = true
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('google-storage-ready'))
    }
  }
}

export function logout(options: { preserveReconsent?: boolean; notify?: boolean } = {}): void {
  tokenStorageGeneration += 1
  userStorageGeneration += 1
  memTokens = null
  memUser = null
  scoped.removeItem(TOKENS_PLAIN_KEY)
  scoped.removeItem(TOKENS_ENC_KEY)
  scoped.removeItem(USER_PLAIN_KEY)
  scoped.removeItem(USER_ENC_KEY)
  if (!options.preserveReconsent) scoped.removeItem(GOOGLE_OAUTH_RECONSENT_KEY)
  // Notify subscribers (useGoogleAuth) so the UI re-renders to "Connecter
  // Google" without waiting for a manual refresh. Critical when logout()
  // is called from inside refreshAccessToken() on a 4xx — the user has
  // AGENDA open, the refresh fails, tokens are wiped, and without this
  // dispatch the hook's `isConnected` state stays stale until next mount.
  if (options.notify !== false && typeof window !== 'undefined') {
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
  tokenStorageGeneration += 1
  userStorageGeneration += 1
  memTokens = null
  memUser = null
  googleStorageReady = false
}

export function isConnected(): boolean {
  return getStoredTokens() !== null
}
