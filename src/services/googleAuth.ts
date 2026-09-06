import type { GoogleTokens, GoogleUser } from '../types/google'
import { safeJson } from '../utils/safeJson'
import * as scoped from './scopedStorage'
import { apiUrl } from './apiBase'
import { encrypt, decrypt, isCryptoReady, selfTestCrypto, captureCryptoGuard, captureCryptoGenerationGuard, isCryptoContextChanged, isCryptoInitializing } from './crypto'
import { getActiveSessionEpoch, getActiveUserId } from './userSession'
import { captureOwnerErasureGuard } from './projects/localErasureGuard'

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
  'https://www.googleapis.com/auth/calendar.events.owned',
]
export const CURRENT_GOOGLE_OAUTH_PROFILE = 'calendar-events-owned-v2' as const

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
// An installation/relink is not a token refresh. Old capabilities never regain
// authority, even when the same email/refresh token is installed again.
let grantEpoch = 0
let grantAdmissionOpen = false
let grantCryptoCurrent: () => boolean = () => false
function captureGrantCrypto(): () => boolean {
  const generationCurrent = captureCryptoGenerationGuard()
  const keyCurrent = isCryptoReady() ? captureCryptoGuard() : () => !isCryptoReady()
  return () => generationCurrent() && keyCurrent() && !isCryptoInitializing()
}
let cacheOwner: GoogleStorageOwner | null = null
const grantInvalidationListeners = new Set<() => void>()
let notifyingGrantInvalidation = false
/** Local, content-free notification. It never refreshes or reconnects Google. */
export function onGoogleGrantInvalidated(listener: () => void): () => void {
  grantInvalidationListeners.add(listener)
  return () => { grantInvalidationListeners.delete(listener) }
}
function revokeGrant(): number {
  grantAdmissionOpen = false
  grantCryptoCurrent = () => false
  validAccessTokenRefresh = null
  refreshAttempt = null
  const revokedEpoch = ++grantEpoch
  // Close authority BEFORE callbacks, including reentrant readers. Preserve
  // this call's epoch if a callback starts another installation.
  if (!notifyingGrantInvalidation) {
    notifyingGrantInvalidation = true
    try { for (const listener of [...grantInvalidationListeners]) { try { listener() } catch { /* isolate observers */ } } }
    finally { notifyingGrantInvalidation = false }
  }
  return revokedEpoch
}
function ensureCacheOwner(): boolean {
  const owner = currentStorageOwner()
  const resets = !!cacheOwner && !storageOwnerMatches(cacheOwner), expectedEpoch = grantEpoch + (resets ? 1 : 0)
  if (resets) resetGoogleMemCache()
  cacheOwner = currentStorageOwner()
  return storageOwnerMatches(owner) && grantEpoch === expectedEpoch
}

interface ValidAccessTokenRefresh {
  ownerId: string | null
  sessionEpoch: number
  grantEpoch: number
  promise: Promise<string | null>
}

// Source unique de mutualisation : useGoogleAuth, usePlanStatus et les clients
// API peuvent tous demander un token au même retour d'arrière-plan. Sans ce
// verrou, chacun lançait son propre POST /api/auth/refresh et les gardes de
// génération invalidaient les réponses concurrentes pourtant valides.
let validAccessTokenRefresh: ValidAccessTokenRefresh | null = null
let refreshAttempt: (Omit<ValidAccessTokenRefresh, 'promise'> & { promise: Promise<GoogleTokens | null> }) | null = null
let userStorageGeneration = 0

const TOKENS_PLAIN_KEY = 'google-tokens'
const TOKENS_ENC_KEY = 'google-tokens-enc'
const USER_PLAIN_KEY = 'google-user'
const USER_ENC_KEY = 'google-user-enc'
// One-time OAuth epoch. Existing installs may hold refresh tokens issued before
// mailbox access was removed. We revoke and purge that grant once, then require
// a fresh sign-in with the reduced scopes above.
const MAILBOX_FREE_OAUTH_EPOCH_KEY = 'google-oauth-mailbox-free-v1'
// Second one-shot epoch: grants persisted before 1.0.99 did not bind their
// refresh token to the verified Google identity. Revoke them once rather than
// risk recycling a token from another account after a historical A -> B race.
const IDENTITY_BOUND_OAUTH_EPOCH_KEY = 'google-oauth-identity-bound-v2'
const GOOGLE_OAUTH_RECONSENT_KEY = 'google-oauth-reconsent-required'
const GOOGLE_CRYPTO_TRANSFER_KEY = 'google-crypto-transfer-pending-v1'
const GOOGLE_RECORD_KEYS = [TOKENS_ENC_KEY, USER_ENC_KEY, TOKENS_PLAIN_KEY, USER_PLAIN_KEY,
  MAILBOX_FREE_OAUTH_EPOCH_KEY, IDENTITY_BOUND_OAUTH_EPOCH_KEY, GOOGLE_OAUTH_RECONSENT_KEY] as const
const hasPendingKeyTransfer = () => scoped.getItem(GOOGLE_CRYPTO_TRANSFER_KEY) !== null

export class GoogleKeyTransferUnavailable extends Error {
  constructor() { super('Google credentials must finish loading or be reconnected before editing API keys'); this.name = 'GoogleKeyTransferUnavailable' }
}
export interface GoogleKeyChange {
  /** Inside the synchronous API-key commit, BEFORE it writes the new key. */
  begin(): void
  /** The caller must attest its exact init attempt and committed API-key raw. */
  finish(currentAttempt: () => boolean): Promise<boolean>
  /** False after another transfer/relink wins; prevents stale failure notices. */
  isCurrent(): boolean
}
function googleRecords() { return GOOGLE_RECORD_KEYS.map(key => scoped.getItem(key)) }
function sameGoogleRecords(raws: (string | null)[]) { return GOOGLE_RECORD_KEYS.every((key, index) => scoped.getItem(key) === raws[index]) }

/** Verify hot-cache provenance under the OLD key before changing it. An absent
 * capability is not evidence of absent encrypted credentials. No OAuth request,
 * promotion of scopes, forced bootstrap or historical-cache rewrite here. */
export async function prepareGoogleKeyChange(): Promise<GoogleKeyChange | null> {
  if (!ensureCacheOwner()) throw new GoogleKeyTransferUnavailable()
  const raws = googleRecords()
  if (!hasPendingKeyTransfer() && !raws.slice(0, 4).some(raw => raw !== null) && !memTokens && !memUser) return null
  const lease = captureGrantContext(), owner = currentStorageOwner(), cryptoCurrent = captureCryptoGuard()
  const assertNotErasing = captureOwnerErasureGuard(owner.userId)
  const tokens = memTokens && Object.freeze({ ...memTokens }), user = memUser && Object.freeze({ ...memUser })
  const oldTokenGeneration = tokenStorageGeneration, oldUserGeneration = userStorageGeneration
  const assertSource = () => {
    assertNotErasing()
    if (!lease?.isCurrent() || !cryptoCurrent() || oldTokenGeneration !== tokenStorageGeneration ||
        oldUserGeneration !== userStorageGeneration || !sameGoogleRecords(raws)) throw new GoogleKeyTransferUnavailable()
  }
  assertSource()
  if (!tokens || !user) throw new GoogleKeyTransferUnavailable()
  const stored = await Promise.all([raws[0] !== null ? decrypt(raws[0]!) : Promise.resolve(raws[2]),
    raws[1] !== null ? decrypt(raws[1]!) : Promise.resolve(raws[3])]).catch(() => { throw new GoogleKeyTransferUnavailable() })
  assertSource()
  if (stored[0] !== JSON.stringify(tokens) || stored[1] !== JSON.stringify(user)) throw new GoogleKeyTransferUnavailable()
  const tokenGeneration = ++tokenStorageGeneration, userGeneration = ++userStorageGeneration, epoch = revokeGrant()
  if (!storageOwnerMatches(owner) || epoch !== grantEpoch || !cryptoCurrent()) throw new GoogleKeyTransferUnavailable()
  const nonce = crypto.randomUUID()
  let begun = false
  const assertAuthority = () => {
    assertNotErasing()
    if (!storageOwnerMatches(owner) || epoch !== grantEpoch || tokenGeneration !== tokenStorageGeneration ||
        userGeneration !== userStorageGeneration ||
        scoped.getItem(GOOGLE_CRYPTO_TRANSFER_KEY) !== (begun ? nonce : null)) throw new GoogleKeyTransferUnavailable()
  }
  const assertOwner = () => { assertAuthority(); if (!sameGoogleRecords(raws)) throw new GoogleKeyTransferUnavailable() }
  const begin = () => {
    assertOwner()
    if (!begun) { scoped.setItem(GOOGLE_CRYPTO_TRANSFER_KEY, nonce); begun = true }
  }
  return Object.freeze({ begin, isCurrent: () => { try { assertAuthority(); return true } catch { return false } }, finish: async (currentAttempt: () => boolean) => {
    try {
      if (!currentAttempt() || !isCryptoReady()) return false
      begin()
      return await writeGooglePairStrict(tokens, user, nonce, () => {
        assertAuthority()
        return currentAttempt()
      })
    } catch { return false }
    finally {
      if (storageOwnerMatches(owner) && epoch === grantEpoch && typeof window !== 'undefined') {
        googleStorageReady = true
        window.dispatchEvent(new CustomEvent('google-storage-ready'))
      }
    }
  } })
}

/** A small durable interruption marker closes every reader across reload. The
 * two legacy keys are NOT an atomic store: compensate only our own exact raws
 * on an ordinary failure, retaining the marker if completion is unproven. */
async function writeGooglePairStrict(tokensInput: GoogleTokens, userInput: GoogleUser, nonce: string, current: () => boolean): Promise<boolean> {
  const tokens = Object.freeze({ ...tokensInput }), user = Object.freeze({ ...userInput })
  const raws = googleRecords(), cryptoCurrent = captureCryptoGuard()
  const assertCurrent = () => {
    if (!cryptoCurrent() || !current() || scoped.getItem(GOOGLE_CRYPTO_TRANSFER_KEY) !== nonce || !sameGoogleRecords(raws)) throw new GoogleKeyTransferUnavailable()
  }
  const writes: { key: string; before: string | null; after: string }[] = []
  try {
    assertCurrent()
    const [encryptedTokens, encryptedUser] = await Promise.all([encrypt(JSON.stringify(tokens)), encrypt(JSON.stringify(user))])
    assertCurrent()
    // No await between guarded replacements. A process interruption is handled
    // by the pending marker, not by pretending this pair is transactional.
    for (const [index, value] of [encryptedTokens, encryptedUser].entries()) {
      const key = GOOGLE_RECORD_KEYS[index]!, before = scoped.getItem(key)
      scoped.setItem(key, value); writes.push({ key, before, after: value })
    }
    scoped.removeItem(GOOGLE_CRYPTO_TRANSFER_KEY)
    memTokens = tokens; memUser = user
    grantCryptoCurrent = cryptoCurrent
    grantAdmissionOpen = true
    for (const key of [TOKENS_PLAIN_KEY, USER_PLAIN_KEY]) { try { scoped.removeItem(key) } catch { /* encrypted pair committed */ } }
    return true
  } catch {
    let mayCompensate = false
    try { mayCompensate = cryptoCurrent() && current() && scoped.getItem(GOOGLE_CRYPTO_TRANSFER_KEY) === nonce } catch { /* lost authority */ }
    if (mayCompensate) for (const write of writes.reverse()) {
      try {
        if (scoped.getItem(write.key) === write.after) {
          if (write.before === null) scoped.removeItem(write.key); else scoped.setItem(write.key, write.before)
        }
      } catch { /* preserve the durable pending marker; fresh sign-in is required */ }
    }
    return false
  }
}

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

function normalizedGoogleEmail(email: string | undefined): string {
  return email?.trim().toLowerCase() || ''
}

async function migrateLegacyGrantForEpoch(
  epochKeys: string[],
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (!options.force && epochKeys.every((epochKey) => scoped.getItem(epochKey) === '1')) return false

  // A retained encrypted blob with no decrypted cache means the crypto key is
  // temporarily unavailable. Do not mark the epoch complete: retry next boot.
  if (scoped.getItem(TOKENS_ENC_KEY) && !memTokens) return false

  const tokens = getStoredTokens()
  if (!tokens) {
    for (const epochKey of epochKeys) {
      try { scoped.setItem(epochKey, '1') } catch { /* retry next bootstrap */ }
    }
    return false
  }

  const tokenToRevoke = tokens.refresh_token || tokens.access_token
  // Keep subscribers quiet until bounded revocation + native cache cleanup
  // finish. bootstrapGoogleStorage publishes one coherent ready event after.
  logout({ preserveReconsent: true, notify: false })
  // Purging above is the security boundary. Marker/notice writes are
  // best-effort so a storage error can never leave an incoherent grant live.
  for (const epochKey of epochKeys) {
    try { scoped.setItem(epochKey, '1') } catch { /* retry next bootstrap */ }
  }
  try {
    scoped.setItem(GOOGLE_OAUTH_RECONSENT_KEY, CURRENT_GOOGLE_OAUTH_PROFILE)
  } catch { /* disconnected UI remains fail-closed */ }
  // The same-origin server bridge is the single revocation authority. Do not
  // launch a native Google Task here: a late Task completion could invalidate
  // the fresh grant after the reconnect CTA becomes available.
  await revokeLegacyGoogleGrant(tokenToRevoke)
  return true
}

export async function migrateLegacyMailboxGrant(): Promise<boolean> {
  const tokens = getStoredTokens()
  const user = getStoredUser()
  const verifiedEmail = normalizedGoogleEmail(tokens?.verified_email)
  const identityMatches = !!verifiedEmail
    && verifiedEmail === normalizedGoogleEmail(user?.email)

  // calendar-events-owned-v2 is server-proven exact and therefore mailbox-free.
  // The identity binding travels in the same encrypted blob as its refresh token;
  // only that fully coherent state may self-heal interrupted epoch markers.
  if (tokens?.oauth_profile === CURRENT_GOOGLE_OAUTH_PROFILE && identityMatches) {
    try { scoped.setItem(MAILBOX_FREE_OAUTH_EPOCH_KEY, '1') } catch { /* retry */ }
    try { scoped.setItem(IDENTITY_BOUND_OAUTH_EPOCH_KEY, '1') } catch { /* retry */ }
    return false
  }
  return migrateLegacyGrantForEpoch([
    MAILBOX_FREE_OAUTH_EPOCH_KEY,
    IDENTITY_BOUND_OAUTH_EPOCH_KEY,
  ], { force: !!tokens })
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

const WEB_OAUTH_HOSTS = new Set([
  'tryarty.com',
])

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/**
 * OAuth state + PKCE vivent dans sessionStorage et sont donc strictement liés
 * à l'origine qui lance le login. Un callback cross-origin perd les deux et
 * doit échouer. Cette résolution pure verrouille l'invariant avant même de
 * construire l'URL Google.
 */
export function resolveWebGoogleRedirectUri(
  origin: string,
  configuredRedirectUri?: string,
): string {
  const currentUrl = new URL(origin)
  const normalizedOrigin = currentUrl.origin
  const hostname = currentUrl.hostname
  const loopback = isLoopbackHost(hostname)
  const supportedHost = WEB_OAUTH_HOSTS.has(hostname) || loopback
  const supportedProtocol = currentUrl.protocol === 'https:' || currentUrl.protocol === 'http:'

  if (!supportedHost) {
    throw new Error(`Origine OAuth Google non autorisée : ${hostname}`)
  }
  if (!supportedProtocol) {
    throw new Error(`Protocole OAuth Google non autorisé : ${currentUrl.protocol}`)
  }
  if (!loopback && currentUrl.protocol !== 'https:') {
    throw new Error(`OAuth Google exige HTTPS pour ${hostname}`)
  }

  const callback = new URL('/auth/callback', normalizedOrigin).toString()
  if (configuredRedirectUri) {
    const configured = new URL(configuredRedirectUri, normalizedOrigin)
    if (configured.origin !== normalizedOrigin) {
      // La config Cloudflare historique pointait tryarty.com vers
      // appfacade.pages.dev : le state et le verifier PKCE devenaient alors
      // invisibles au callback. La valeur est ignorée plutôt que de relâcher
      // les protections CSRF/PKCE.
      console.warn('[googleAuth] redirect URI cross-origin ignorée', {
        configuredOrigin: configured.origin,
        currentOrigin: normalizedOrigin,
      })
    }
  }
  return callback
}

export function getRedirectUri(): string {
  if (typeof window === 'undefined') {
    const configured = import.meta.env.VITE_GOOGLE_REDIRECT_URI
    if (!configured) throw new Error('VITE_GOOGLE_REDIRECT_URI manquant hors navigateur')
    return configured
  }
  return resolveWebGoogleRedirectUri(
    window.location.origin,
    import.meta.env.VITE_GOOGLE_REDIRECT_URI,
  )
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
  const redirectUri = getRedirectUri()

  const state = generateOAuthState()
  // PKCE (F-11) : générer + persister le verifier, envoyer le challenge S256.
  const verifier = generateCodeVerifier()
  const codeChallenge = await computeCodeChallenge(verifier)
  try {
    sessionStorage.setItem(OAUTH_STATE_KEY, state)
    sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier)
  } catch {
    clearOAuthState()
    throw new Error('Le stockage de session est indisponible pour sécuriser la connexion Google')
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
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
  persistGrant = false,
): Promise<GoogleTokens> {
  if (!ensureCacheOwner()) throw new Error('Google token exchange was superseded')
  const exchangeOwner = currentStorageOwner(), exchangeEpoch = grantEpoch
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
  if (!storageOwnerMatches(exchangeOwner) || exchangeEpoch !== grantEpoch) {
    throw new Error('Google token exchange was superseded')
  }
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
  if (persistGrant) {
    throw new Error('Google identity must be verified before persisting the grant')
  }
  return tokens
}

export interface GoogleStorageOwner {
  userId: string | null
  sessionEpoch: number
}

function currentStorageOwner(): GoogleStorageOwner {
  return { userId: getActiveUserId(), sessionEpoch: getActiveSessionEpoch() }
}

function storageOwnerMatches(expected: GoogleStorageOwner): boolean {
  try {
    return getActiveUserId() === expected.userId && getActiveSessionEpoch() === expected.sessionEpoch
  } catch { return false }
}

/** Bind reconnect preparation before its first await, including a disconnected
 * pending-transfer state. Only the actual writer receipt may advance it. */
export function captureGoogleAuthIntent(): () => boolean {
  try {
    if (!ensureCacheOwner()) return () => false
    const owner = currentStorageOwner(), epoch = grantEpoch, cryptoCurrent = captureGrantCrypto()
    return () => storageOwnerMatches(owner) && epoch === grantEpoch && cryptoCurrent()
  } catch { return () => false }
}

export async function storeTokens(
  tokens: GoogleTokens,
  expectedOwner?: GoogleStorageOwner,
  onWriteStarted?: (isCurrent: () => boolean) => void,
): Promise<boolean> {
  const owner = currentStorageOwner(), cryptoCurrent = captureGrantCrypto()
  if (!ensureCacheOwner()) return false
  if (!storageOwnerMatches(owner) || !cryptoCurrent() || (expectedOwner && !storageOwnerMatches(expectedOwner)) || isCryptoInitializing() || hasPendingKeyTransfer()) return false
  const epoch = revokeGrant()
  if (!storageOwnerMatches(owner) || epoch !== grantEpoch || !cryptoCurrent()) return false
  onWriteStarted?.(() => storageOwnerMatches(owner) && epoch === grantEpoch && cryptoCurrent())
  const committed = await writeTokens(tokens, expectedOwner ?? owner, () => epoch === grantEpoch && cryptoCurrent())
  if (epoch !== grantEpoch || !storageOwnerMatches(owner) || !cryptoCurrent()) return false
  grantAdmissionOpen = committed && (!memUser || !memTokens?.verified_email ||
    normalizedGoogleEmail(memUser.email) === normalizedGoogleEmail(memTokens.verified_email))
  grantCryptoCurrent = cryptoCurrent
  return committed
}

/** Only refresh/bootstrap use this writer without rotating the logical grant. */
async function writeTokens(
  input: GoogleTokens,
  expectedOwner?: GoogleStorageOwner,
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (expectedOwner && !storageOwnerMatches(expectedOwner)) return false
  if (isCryptoInitializing() || !stillCurrent()) return false
  const tokens = Object.freeze({ ...input })
  const cryptoCurrent = isCryptoReady() ? captureCryptoGuard() : () => true
  const ownerAtStart = currentStorageOwner()
  const writeGeneration = ++tokenStorageGeneration
  const writeStillCurrent = () =>
    writeGeneration === tokenStorageGeneration
    && storageOwnerMatches(ownerAtStart)
    && (!expectedOwner || storageOwnerMatches(expectedOwner))
    && cryptoCurrent()
    && stillCurrent()
  const abandonWrite = () => false
  if (isCryptoReady()) {
    try {
      const encrypted = await encrypt(JSON.stringify(tokens))
      if (!writeStillCurrent()) return abandonWrite()
      scoped.setItem(TOKENS_ENC_KEY, encrypted)
      memTokens = tokens
      try { scoped.removeItem(TOKENS_PLAIN_KEY) } catch { /* encrypted copy committed */ }
      return true
    } catch (error) {
      if (isCryptoContextChanged(error)) return abandonWrite()
      if (!writeStillCurrent()) return abandonWrite()
      // fall through to plain storage
    }
  }
  // Crypto not ready yet — write plain JSON so sync reads still work.
  // Will be re-encrypted at the next `bootstrapGoogleStorage()` call.
  if (writeStillCurrent()) {
    try { scoped.setJSON(TOKENS_PLAIN_KEY, tokens); memTokens = tokens; return true }
    catch (error) { abandonWrite(); throw error }
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
export async function storeMailboxFreeGrant(
  tokens: GoogleTokens,
  expectedOwner?: GoogleStorageOwner,
  options: {
    preserveExistingRefreshToken?: boolean
    /** Identité issue du même grant, vérifiée via Google userinfo. */
    verifiedEmail?: string
    /** Armed only by this call's actual writer, never by a guessed next epoch. */
    onWriteStarted?: (isCurrent: () => boolean) => void
  } = {},
): Promise<GoogleTokens> {
  const ownerAtStart = currentStorageOwner(), cryptoAtStart = captureGrantCrypto()
  if (!ensureCacheOwner()) throw new Error('Google grant storage was superseded')
  if (!storageOwnerMatches(ownerAtStart) || !cryptoAtStart() || (expectedOwner && !storageOwnerMatches(expectedOwner))) {
    throw new Error('Google grant storage was superseded')
  }
  const existingTokens = getStoredTokens()
  const verifiedEmail = normalizedGoogleEmail(options.verifiedEmail)
  if (!verifiedEmail) {
    throw new Error('Verified Google email is required to persist the grant')
  }
  const existingRefreshToken = options.preserveExistingRefreshToken !== false
    && existingTokens?.oauth_profile === CURRENT_GOOGLE_OAUTH_PROFILE
    && !!verifiedEmail
    && existingTokens.verified_email === verifiedEmail
    ? existingTokens.refresh_token
    : ''

  const mailboxFreeTokens: GoogleTokens = {
    ...tokens,
    refresh_token: tokens.refresh_token || existingRefreshToken || '',
    oauth_profile: CURRENT_GOOGLE_OAUTH_PROFILE,
    verified_email: verifiedEmail || undefined,
  }

  // Persister d'abord le nouveau grant, puis seulement son marqueur. Si
  // l'écriture ou l'application s'interrompt entre les deux, le bootstrap
  // traitera le grant comme legacy et forcera une reconnexion sûre.
  const previousEpoch = grantEpoch
  const pendingTransfer = scoped.getItem(GOOGLE_CRYPTO_TRANSFER_KEY)
  let committed: boolean
  if (pendingTransfer !== null) {
    // Only a newly verified, coherent sign-in may complete an interrupted pair.
    if (!memUser || normalizedGoogleEmail(memUser.email) !== verifiedEmail || !isCryptoReady()) throw new GoogleKeyTransferUnavailable()
    const cryptoCurrent = captureCryptoGuard(), assertNotErasing = captureOwnerErasureGuard(ownerAtStart.userId), user = memUser
    const tokenGeneration = ++tokenStorageGeneration, userGeneration = ++userStorageGeneration
    const epoch = revokeGrant()
    if (!storageOwnerMatches(ownerAtStart) || epoch !== grantEpoch || !cryptoCurrent()) throw new GoogleKeyTransferUnavailable()
    options.onWriteStarted?.(() => storageOwnerMatches(ownerAtStart) && epoch === grantEpoch && cryptoCurrent())
    committed = await writeGooglePairStrict(mailboxFreeTokens, user, pendingTransfer, () => {
      assertNotErasing()
      return epoch === grantEpoch && storageOwnerMatches(ownerAtStart) && cryptoCurrent() &&
        tokenGeneration === tokenStorageGeneration && userGeneration === userStorageGeneration
    })
  } else committed = await storeTokens(mailboxFreeTokens, expectedOwner, options.onWriteStarted)
  if (!committed || !storageOwnerMatches(ownerAtStart) || grantEpoch !== previousEpoch + 1) {
    throw new Error('Google grant storage was superseded')
  }
  scoped.setItem(MAILBOX_FREE_OAUTH_EPOCH_KEY, '1')
  scoped.setItem(IDENTITY_BOUND_OAUTH_EPOCH_KEY, '1')
  scoped.removeItem(GOOGLE_OAUTH_RECONSENT_KEY)
  // Le flux natif reste sur la même vue : publier immédiatement le nouveau
  // grant afin que useGoogleAuth et usePlanStatus relisent la session/VIP sans
  // attendre un focus ou un redémarrage. Le callback web bénéficie du même
  // signal avant sa navigation finale.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('google-storage-ready'))
  }
  return mailboxFreeTokens
}

export async function storeUser(
  user: GoogleUser,
  expectedOwner?: GoogleStorageOwner,
  onWriteStarted?: (isCurrent: () => boolean) => void,
): Promise<boolean> {
  const owner = currentStorageOwner(), cryptoCurrent = captureGrantCrypto()
  if (!ensureCacheOwner()) return false
  if (!storageOwnerMatches(owner) || !cryptoCurrent() || (expectedOwner && !storageOwnerMatches(expectedOwner)) || isCryptoInitializing()) return false
  const epoch = revokeGrant()
  if (!storageOwnerMatches(owner) || epoch !== grantEpoch || !cryptoCurrent()) return false
  onWriteStarted?.(() => storageOwnerMatches(owner) && epoch === grantEpoch && cryptoCurrent())
  // Remain closed between identity publication and the following grant install.
  return writeUser(user, expectedOwner ?? owner, () => epoch === grantEpoch && cryptoCurrent())
}

async function writeUser(
  input: GoogleUser,
  expectedOwner?: GoogleStorageOwner,
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (expectedOwner && !storageOwnerMatches(expectedOwner)) return false
  if (isCryptoInitializing() || !stillCurrent()) return false
  const user = Object.freeze({ ...input })
  const cryptoCurrent = isCryptoReady() ? captureCryptoGuard() : () => true
  const ownerAtStart = currentStorageOwner()
  const writeGeneration = ++userStorageGeneration
  const previousMemUser = memUser
  const writeStillCurrent = () =>
    writeGeneration === userStorageGeneration
    && storageOwnerMatches(ownerAtStart)
    && (!expectedOwner || storageOwnerMatches(expectedOwner))
    && cryptoCurrent()
    && stillCurrent()
  const abandonWrite = () => {
    if (writeGeneration === userStorageGeneration && memUser === user) memUser = storageOwnerMatches(ownerAtStart) ? previousMemUser : null
    return false
  }
  memUser = user
  if (isCryptoReady()) {
    try {
      const encrypted = await encrypt(JSON.stringify(user))
      if (!writeStillCurrent()) return abandonWrite()
      let encryptedCommitted = false
      try {
        scoped.setItem(USER_ENC_KEY, encrypted)
        encryptedCommitted = true
      } catch {
        // fall through to the plain storage fallback below
      }
      if (encryptedCommitted) {
        try { scoped.removeItem(USER_PLAIN_KEY) } catch { /* encrypted copy committed */ }
        return true
      }
    } catch (error) {
      if (isCryptoContextChanged(error)) return abandonWrite()
      if (!writeStillCurrent()) return abandonWrite()
      // fall through
    }
  }
  if (writeStillCurrent()) {
    try {
      scoped.setJSON(USER_PLAIN_KEY, user)
      return true
    } catch {
      return abandonWrite()
    }
  }
  return abandonWrite()
}

export interface GoogleGrantLease {
  isCurrent(): boolean
  getAccessToken(): Promise<string | null>
}
interface GrantContext extends GoogleGrantLease {
  readonly ownerId: string | null
  readonly sessionEpoch: number
  readonly epoch: number
}

function captureGrantContext(): GrantContext | null {
  try {
  const tokens = getStoredTokens()
  if (!grantAdmissionOpen || !grantCryptoCurrent() || !tokens || isCryptoInitializing()) return null
  const owner = currentStorageOwner(), epoch = grantEpoch
  const cryptoCurrent = captureGrantCrypto()
  // Scalar snapshot; no reference to an object returned to another caller.
  const refreshToken = tokens.refresh_token, email = tokens.verified_email
  const isCurrent = () => {
    try {
    if (!storageOwnerMatches(owner) || epoch !== grantEpoch || !grantAdmissionOpen || !cryptoCurrent()) return false
    const current = getStoredTokens()
    // A server-verified refresh may populate the previously absent profile on
    // a legacy grant. Only the private refresh writer can do this without an
    // epoch rotation; public installations always revoke this capability.
    return !!current && current.refresh_token === refreshToken && current.verified_email === email
    } catch { return false }
  }
  const context: GrantContext = Object.freeze({ ownerId: owner.userId, sessionEpoch: owner.sessionEpoch, epoch,
    isCurrent, getAccessToken: () => validTokenForGrant(context).catch(() => null) })
  return context
  } catch { return null }
}

/** Capture before confirmation/preparation. No token is exposed by the handle. */
export function captureGoogleGrant(): GoogleGrantLease | null { return captureGrantContext() }

/** Local configuration, not remote health. No bootstrap, refresh or remote
 * revocation. Existing owner guards may discard an obsolete in-memory grant. */
export function getGoogleConfigurationStatus(): 'loading' | 'not-configured' | 'reconnect' | 'configured' | 'unavailable' {
  try {
    const tokens = getStoredTokens(), user = getStoredUser()
    if (!isGoogleStorageReady() || isCryptoInitializing()) return 'loading'
    if (isGoogleOAuthReconsentRequired()) return 'reconnect'
    if (!tokens && !user) return hasPendingKeyTransfer() || googleRecords().slice(0, 4).some(value => value !== null) ? 'unavailable' : 'not-configured'
    if (!tokens || !user || tokens.oauth_profile !== CURRENT_GOOGLE_OAUTH_PROFILE ||
      !tokens.verified_email || normalizedGoogleEmail(user.email) !== normalizedGoogleEmail(tokens.verified_email)) return 'unavailable'
    return captureGrantContext()?.isCurrent() ? 'configured' : 'unavailable'
  } catch { return 'unavailable' }
}

export async function refreshAccessToken(): Promise<GoogleTokens | null> {
  const context = captureGrantContext()
  if (!context) return null
  const tokens = await sharedRefreshAttempt(context)
  return context.isCurrent() && tokens ? { ...tokens } : null
}

/** Share one HTTP + persistence attempt, not the getter's retry policy. A
 * direct refresh still settles after one attempt whichever caller started it. */
function sharedRefreshAttempt(context: GrantContext): Promise<GoogleTokens | null> {
  if (refreshAttempt?.ownerId === context.ownerId && refreshAttempt.sessionEpoch === context.sessionEpoch && refreshAttempt.grantEpoch === context.epoch) {
    return refreshAttempt.promise
  }
  let finish!: (tokens: GoogleTokens | null) => void
  const task = {
    ownerId: context.ownerId, sessionEpoch: context.sessionEpoch, grantEpoch: context.epoch,
    promise: new Promise<GoogleTokens | null>(resolve => { finish = resolve }),
  }
  refreshAttempt = task
  void refreshTokenForGrant(context).catch(() => null).then(tokens => {
    if (refreshAttempt === task) refreshAttempt = null
    finish(context.isCurrent() ? tokens : null)
  })
  return task.promise
}

async function refreshTokenForGrant(context: GrantContext): Promise<GoogleTokens | null> {
  if (!context.isCurrent()) return null
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

  if (!context.isCurrent() || refreshGeneration !== tokenStorageGeneration) return null

  let data: any
  try {
    data = await safeJson(res)
  } catch (err) {
    console.warn('[googleAuth] refresh response unreadable, keeping tokens. status=', res.status, err)
    return null
  }

  if (!context.isCurrent() || refreshGeneration !== tokenStorageGeneration) return null

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
    verified_email: tokens.verified_email,
  }

  if (data.oauth_profile !== CURRENT_GOOGLE_OAUTH_PROFILE) {
    scoped.setItem(GOOGLE_OAUTH_RECONSENT_KEY, CURRENT_GOOGLE_OAUTH_PROFILE)
    logout({ preserveReconsent: true })
    return null
  }

  // A logout, profile migration, fresh login, or newer refresh won the race
  // while this request was in flight. Discard this stale response.
  if (
    !context.isCurrent() || refreshGeneration !== tokenStorageGeneration
    || getStoredTokens()?.refresh_token !== tokens.refresh_token
  ) return null

  const committed = await writeTokens(updated, { userId: context.ownerId, sessionEpoch: context.sessionEpoch }, context.isCurrent).catch(() => false)
  return committed && context.isCurrent() && getStoredTokens()?.access_token === updated.access_token ? { ...updated } : null
}

async function refreshExpiringAccessToken(context: GrantContext): Promise<string | null> {
  let tokens: GoogleTokens | null
  // Refresh if expiring within 5 minutes. Retry up to 3 times with backoff
  // (0s, 1.5s, 3s) to ride out Cloudflare/network blips on cold-resume —
  // typical scenario: app comes back from background after >1h, mobile
  // radio re-warms (~1-3s), first refresh attempt fails, second succeeds.
  // Stop early if the refresh path called logout() (= invalid_grant, tokens
  // wiped definitively).
  const delays = [0, 1500, 3000]
  for (const delay of delays) {
    if (!context.isCurrent()) return null
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    if (!context.isCurrent()) return null
    tokens = await sharedRefreshAttempt(context)
    if (!context.isCurrent()) return null
    if (tokens) return tokens.access_token
    if (!getStoredTokens()) return null // logout() was called → give up
  }
  console.warn('[googleAuth] refresh failed after retries, keeping tokens for next attempt')
  return null
}

export async function getValidAccessToken(): Promise<string | null> {
  const context = captureGrantContext()
  return context ? context.getAccessToken() : null
}

async function validTokenForGrant(context: GrantContext): Promise<string | null> {
  if (!context.isCurrent()) return null
  const tokens = getStoredTokens()
  if (!tokens) return null

  // Ignore placeholder/fake tokens
  if (!tokens.access_token || tokens.access_token === 'native') return null

  // A direct refresh is shared too, including its encrypted persistence phase.
  if (validAccessTokenRefresh?.ownerId === context.ownerId &&
      validAccessTokenRefresh.sessionEpoch === context.sessionEpoch && validAccessTokenRefresh.grantEpoch === context.epoch) {
    const result = await validAccessTokenRefresh.promise
    return context.isCurrent() ? result : null
  }
  if (tokens.expires_at - Date.now() < 5 * 60 * 1000) {
    const task: ValidAccessTokenRefresh = {
      ownerId: context.ownerId, sessionEpoch: context.sessionEpoch, grantEpoch: context.epoch,
      promise: Promise.resolve(null),
    }
    task.promise = refreshExpiringAccessToken(context).finally(() => {
      if (validAccessTokenRefresh === task) validAccessTokenRefresh = null
    })
    validAccessTokenRefresh = task
    const result = await task.promise
    return context.isCurrent() ? result : null
  }

  if (refreshAttempt?.ownerId === context.ownerId && refreshAttempt.sessionEpoch === context.sessionEpoch && refreshAttempt.grantEpoch === context.epoch) {
    const result = await refreshAttempt.promise
    return context.isCurrent() ? result?.access_token ?? null : null
  }

  return tokens.access_token
}

export async function fetchGoogleUser(
  accessToken: string,
  persistUser = true,
): Promise<GoogleUser> {
  if (!ensureCacheOwner()) throw new Error('Google identity lookup was superseded')
  const requestOwner = currentStorageOwner(), requestEpoch = grantEpoch
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
  if (!storageOwnerMatches(requestOwner) || requestEpoch !== grantEpoch) throw new Error('Google identity lookup was superseded')

  const user: GoogleUser = {
    email: data.email,
    name: data.name,
    picture: data.picture,
  }

  if (persistUser && !(await storeUser(user))) {
    throw new Error('Google user storage was superseded')
  }
  return user
}

/**
 * Synchronous read of the current Google tokens.
 * Returns the in-memory cache if populated (after boot decryption), or the
 * legacy plain-JSON copy for unmigrated data. Returns null if not connected.
 */
export function getStoredTokens(): GoogleTokens | null {
  if (!ensureCacheOwner()) return null
  if (hasPendingKeyTransfer()) return null
  if (memTokens) return { ...memTokens }
  const legacy = scoped.getJSON<GoogleTokens>(TOKENS_PLAIN_KEY)
  if (legacy) memTokens = Object.freeze({ ...legacy })
  return memTokens ? { ...memTokens } : null
}

export function getStoredUser(): GoogleUser | null {
  if (!ensureCacheOwner()) return null
  if (hasPendingKeyTransfer()) return null
  if (memUser) return { ...memUser }
  const legacy = scoped.getJSON<GoogleUser>(USER_PLAIN_KEY)
  if (legacy) memUser = Object.freeze({ ...legacy })
  return memUser ? { ...memUser } : null
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
  const ownerAtStart = getActiveUserId(), epochAtStart = getActiveSessionEpoch(), cryptoCurrent = captureCryptoGuard()
  const sessionCurrent = () => ownerAtStart === getActiveUserId() && epochAtStart === getActiveSessionEpoch() && cryptoCurrent()
  if (!ensureCacheOwner()) return
  if (!sessionCurrent()) return
  const bootGrantEpoch = revokeGrant()
  if (!sessionCurrent() || bootGrantEpoch !== grantEpoch) return
  // This attempt must read its own candidates, not re-admit a previous cache
  // after missing records or an early return during decryption.
  tokenStorageGeneration += 1
  userStorageGeneration += 1
  memTokens = null
  memUser = null
  let bootCompleted = false
  let expectedTokenGeneration = tokenStorageGeneration
  let expectedUserGeneration = userStorageGeneration
  const tokenContextIsCurrent = () =>
    sessionCurrent() && expectedTokenGeneration === tokenStorageGeneration
  const userContextIsCurrent = () =>
    sessionCurrent() && expectedUserGeneration === userStorageGeneration

  try {
    // Interrupted explicit key transfer: preserve both old/new blobs without
    // decryption, corruption cleanup, legacy migration or remote revocation.
    if (hasPendingKeyTransfer()) return
    // Tokens
    const encTokens = scoped.getItem(TOKENS_ENC_KEY)
    if (encTokens) {
      try {
        const decryptedTokens = JSON.parse(await decrypt(encTokens)) as GoogleTokens
        if (!tokenContextIsCurrent() || scoped.getItem(TOKENS_ENC_KEY) !== encTokens) return
        memTokens = Object.freeze({ ...decryptedTokens })
      } catch (err) {
        if (isCryptoContextChanged(err)) return
        if (!tokenContextIsCurrent() || scoped.getItem(TOKENS_ENC_KEY) !== encTokens) return
        // BUG 47 — distinguish "blob genuinely corrupt" (key OK, decrypt
        // fails) from "wrong passphrase loaded" (key mismatch). Only wipe
        // in the first case. The second happens transiently on cold boot
        // when initCrypto runs with a stale or wrong api-keys snapshot,
        // and used to force-relogin after every APK update.
        const keyOk = await selfTestCrypto()
        if (!tokenContextIsCurrent() || scoped.getItem(TOKENS_ENC_KEY) !== encTokens) return
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
        const committed = await writeTokens(plain, currentStorageOwner(), () => sessionCurrent() && grantEpoch === bootGrantEpoch)
        if (!committed || !sessionCurrent()) return
        expectedTokenGeneration = tokenStorageGeneration
      }
    }

    // User
    const encUser = scoped.getItem(USER_ENC_KEY)
    if (encUser) {
      try {
        const decryptedUser = JSON.parse(await decrypt(encUser)) as GoogleUser
        if (!userContextIsCurrent() || scoped.getItem(USER_ENC_KEY) !== encUser) return
        memUser = Object.freeze({ ...decryptedUser })
      } catch (err) {
        if (isCryptoContextChanged(err)) return
        if (!userContextIsCurrent() || scoped.getItem(USER_ENC_KEY) !== encUser) return
        const keyOk = await selfTestCrypto()
        if (!userContextIsCurrent() || scoped.getItem(USER_ENC_KEY) !== encUser) return
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
        const committed = await writeUser(plain, currentStorageOwner(), () => sessionCurrent() && grantEpoch === bootGrantEpoch)
        if (!committed || !sessionCurrent()) return
        expectedUserGeneration = userStorageGeneration
      }
    }

    if (!tokenContextIsCurrent() || !userContextIsCurrent()) return
    const mailboxMigrated = await migrateLegacyMailboxGrant()
    if (!sessionCurrent()) return
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
    bootCompleted = tokenContextIsCurrent() && userContextIsCurrent() && bootGrantEpoch === grantEpoch
  } finally {
    if (bootCompleted && sessionCurrent() && tokenContextIsCurrent() && userContextIsCurrent() && bootGrantEpoch === grantEpoch) {
      grantAdmissionOpen = !!memTokens && !!memUser && memTokens.oauth_profile === CURRENT_GOOGLE_OAUTH_PROFILE &&
        !!normalizedGoogleEmail(memTokens.verified_email) && normalizedGoogleEmail(memTokens.verified_email) === normalizedGoogleEmail(memUser.email)
      grantCryptoCurrent = cryptoCurrent
    }
    // ALWAYS dispatch so the UI never stays stuck waiting — even if the
    // bootstrap threw halfway. Without the finally, a mid-bootstrap crash
    // left subscribers (useGoogleAuth, InputBar) thinking Google was still
    // initialising, hiding the login button forever.
    if (sessionCurrent()) googleStorageReady = true
    if (sessionCurrent() && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('google-storage-ready'))
    }
  }
}

export function logout(options: { preserveReconsent?: boolean; notify?: boolean } = {}): void {
  const owner = currentStorageOwner()
  if (!ensureCacheOwner()) return
  if (!storageOwnerMatches(owner)) return
  const epoch = revokeGrant()
  if (!storageOwnerMatches(owner) || epoch !== grantEpoch) return
  tokenStorageGeneration += 1
  userStorageGeneration += 1
  memTokens = null
  memUser = null
  scoped.removeItem(TOKENS_PLAIN_KEY)
  scoped.removeItem(TOKENS_ENC_KEY)
  scoped.removeItem(USER_PLAIN_KEY)
  scoped.removeItem(USER_ENC_KEY)
  scoped.removeItem(GOOGLE_CRYPTO_TRANSFER_KEY)
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
  cacheOwner = currentStorageOwner()
  tokenStorageGeneration += 1
  userStorageGeneration += 1
  memTokens = null
  memUser = null
  googleStorageReady = false
  // Nothing after notification may erase a reentrant owner's new cache.
  revokeGrant()
}

export function isConnected(): boolean {
  return getStoredTokens() !== null
}
