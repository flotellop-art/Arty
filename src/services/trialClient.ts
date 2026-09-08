/**
 * Trial client — facade pour le plan d'essai gratuit (30 messages).
 *
 * Fournit :
 *   - `initTrial(accessToken, googleEmail)` : appelé après le sign-in Google.
 *     Touche `POST /api/trial/init` côté backend, qui crée la ligne
 *     subscriptions D1 pour les nouveaux users, ou
 *     retourne le plan existant si déjà connu (idempotent).
 *   - `getOnboardingSplash()` / `clearOnboardingSplash()` : pour que App.tsx
 *     décide d'afficher le splash VIP ou l'intro Trial juste après le login.
 *   - `getTrialRemaining()` / `setTrialRemaining(n)` : compteur affiché dans
 *     la bannière, mis à jour à chaque réponse IA via le header
 *     `x-trial-remaining` lu par les AI clients.
 *
 * Le compteur est stocké par utilisateur dès que la session Arty existe.
 * Pendant le court intervalle AVANT setActiveSession (login Google), une clé
 * RAM attribuée au propriétaire exact sert de zone temporaire pour useAuth. Cela évite
 * qu'un solde d'essai d'un compte influence le wallet/routage d'un autre.
 */

import { apiUrl } from './apiBase'
import * as scoped from './scopedStorage'
import { getActiveUserId, generateUserId } from './userSession'
import { consumeAcquisition, getAcquisition } from './acquisition'

const SPLASH_KEY = 'arty-trial-onboarding-splash'
const SPLASH_SHOWN_KEY = 'arty-trial-onboarding-splash-shown'
const REMAINING_KEY = 'arty-trial-remaining'
const SCOPED_REMAINING_KEY = 'trial-remaining'
interface PendingTrial { owner: string; remaining: number | null; splash: SplashState }
let pendingInMemory: PendingTrial | null = null
let splashInMemory: { owner: string; splash: SplashState } | null = null
// Only failed optional display writes, keyed by the existing local owner.
// RAM-only; never contains email, tokens, entitlement or persistent transport.
const failedCacheWrites = new Map<string, string | null>()
let initAttempt = 0

function validRemaining(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30
}

function stagePending(value: PendingTrial): void {
  // Ephemeral metadata: no disk transport to replay after a crash or failed
  // removal. A reload loses an optional welcome, never an entitlement.
  pendingInMemory = value
}

function setSplashForOwner(owner: string, splash: SplashState): void {
  splashInMemory = { owner, splash }
  try { if (localStorage.getItem(SPLASH_SHOWN_KEY) === '1') splashInMemory.splash = null } catch {}
  try { localStorage.removeItem(SPLASH_KEY) } catch {} // ignore legacy ownerless welcome
}

function setRemainingValue(value: string): void {
  const owner = getActiveUserId()
  if (owner) cacheRemaining(owner, value)
  else localStorage.setItem(REMAINING_KEY, value)
}

function removeRemainingValue(): void {
  const owner = getActiveUserId()
  if (owner) cacheRemaining(owner, null)
  else localStorage.removeItem(REMAINING_KEY)
}

function cacheRemaining(owner: string, value: string | null): void {
  try {
    if (value === null) scoped.removeItem(SCOPED_REMAINING_KEY)
    else scoped.setItem(SCOPED_REMAINING_KEY, value)
    failedCacheWrites.delete(owner)
  } catch {
    // A failed optional cache mutation cannot resurrect an older readable30.
    // Only failures override disk reads; normal cross-tab snapshots still work.
    failedCacheWrites.set(owner, value)
  }
}

/**
 * `initTrial` s'exécute avant la création de session Google. Une fois la
 * session active, déplace le compteur temporaire vers le stockage du compte.
 */
export function adoptPendingTrialRemaining(): void {
  try {
    const owner = getActiveUserId()
    if (!owner) return
    const pending = pendingInMemory
    clearPendingTrialRemaining()
    // Never migrate old, ownerless counters or an interrupted neighbour login.
    if (!pending || pending.owner !== owner) return
    setSplashForOwner(owner, pending.splash)
    cacheRemaining(owner, pending.remaining === null ? null : String(pending.remaining))
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed', {
      detail: { remaining: pending.remaining },
    }))
  } catch {}
}

/** Purge seulement la zone temporaire pré-session, jamais le compteur scopé. */
export function clearPendingTrialRemaining(): void {
  pendingInMemory = null
  initAttempt++ // An interrupted login's late response cannot republish metadata.
  try { localStorage.removeItem(REMAINING_KEY) } catch {}
}

export type TrialPlan = 'trial' | 'vip' | 'subscription' | 'pro' | 'free'

export interface TrialInitResponse {
  plan: TrialPlan
  trial_messages_remaining?: number
}

export type SplashState = 'vip' | 'trial' | null

/**
 * Initialise (ou récupère) le statut d'essai pour l'utilisateur Google
 * authentifié. À appeler immédiatement après l'obtention du access_token,
 * AVANT de finaliser auth.login. Stocke un splash post-login + le
 * compteur de messages restants quand applicable.
 *
 * Ne throw jamais — sur erreur réseau/backend, retourne null pour ne pas
 * bloquer le sign-in. L'app fonctionne en mode dégradé (pas de bannière
 * ni de splash) jusqu'au prochain succès.
 */
export async function initTrial(accessToken: string, googleEmail: string): Promise<TrialInitResponse | null> {
  if (!accessToken || !googleEmail) return null
  clearPendingTrialRemaining()
  const attempt = initAttempt
  let owner: string | null = null
  const stage = (remaining: number | null, splash: SplashState) => {
    if (owner && attempt === initAttempt) stagePending({ owner, remaining, splash })
  }
  try {
    // Exact local Google owner, NOT the server's Gmail benefit key.
    owner = await generateUserId('google', googleEmail)
    // Attribution first-party pubs (voir services/acquisition.ts) : attachée
    // au corps si présente, consommée UNIQUEMENT après un aller-retour serveur
    // réussi. Best-effort intégral — ne doit jamais gêner le sign-in.
    const acquisition = getAcquisition()
    const res = await fetch(apiUrl('/api/trial/init'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(acquisition ? { acquisition } : {}),
    })
    if (!res.ok) { stage(null, null); return null }
    if (acquisition) consumeAcquisition()
    const data = (await res.json()) as TrialInitResponse

    if (data.plan === 'vip') {
      stage(null, 'vip')
    } else if (data.plan === 'trial') {
      const remaining = validRemaining(data.trial_messages_remaining) ? data.trial_messages_remaining : null
      stage(remaining, remaining === 30 ? 'trial' : null)
    } else {
      stage(null, null)
    }
    return data
  } catch {
    stage(null, null)
    return null
  }
}

/**
 * Variante de `initTrial` pour l'essai par email : PAS d'appel réseau (le
 * backend a déjà créé la session lors de la vérification OTP). Pose le splash
 * trial (une seule fois par device) + le compteur initial. L'email-trial ne
 * passe jamais par /api/trial/init (réservé aux tokens Google).
 */
export function initEmailTrialSplash(remaining: number | null = null, expectedOwner?: string): void {
  try {
    const owner = getActiveUserId()
    if (!owner || (expectedOwner !== undefined && owner !== expectedOwner)) return
    setSplashForOwner(owner, remaining === 30 ? 'trial' : null)
    if (validRemaining(remaining)) setRemainingValue(String(remaining))
    else removeRemainingValue() // old server or unavailable count is unknown
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed', { detail: { remaining } }))
  } catch {} // quota metadata is not a prerequisite for a valid OTP login
}

export function getOnboardingSplash(expectedOwner?: string | null): SplashState {
  try {
    const owner = getActiveUserId()
    if (owner && (expectedOwner === undefined || expectedOwner === owner) && splashInMemory?.owner === owner) {
      return splashInMemory.splash
    }
  } catch {}
  return null
}

export function clearOnboardingSplash(): void {
  splashInMemory = null
  try { localStorage.removeItem(SPLASH_KEY) } catch {}
  try { localStorage.setItem(SPLASH_SHOWN_KEY, '1') } catch {}
}

export function getTrialRemaining(): number | null {
  try {
    const owner = getActiveUserId()
    const raw = owner && failedCacheWrites.has(owner) ? failedCacheWrites.get(owner) ?? null
      : owner ? scoped.getItem(SCOPED_REMAINING_KEY) : localStorage.getItem(REMAINING_KEY)
    if (raw === null) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? Math.max(0, n) : null
  } catch { return null }
}

/**
 * Met à jour le compteur trial. Appelé par les AI clients après chaque
 * réponse, en lisant le header `x-trial-remaining` du proxy. Émet un
 * CustomEvent pour que la bannière React se rafraîchisse sans avoir à
 * polling localStorage.
 */
export function setTrialRemaining(n: number): void {
  setRemainingValue(String(Math.max(0, n)))
  try {
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed', { detail: { remaining: n } }))
  } catch {
    // CustomEvent peut échouer dans certains environnements de test ; ignore.
  }
}

export function clearTrialRemaining(): void {
  splashInMemory = null
  removeRemainingValue()
  // Peut subsister si un login pré-session a été interrompu.
  clearPendingTrialRemaining()
  try {
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed', { detail: { remaining: null } }))
  } catch {}
}

/**
 * Helper appelé par les AI clients à chaque réponse fetch. Lit le header
 * `x-trial-remaining` (exposé via Access-Control-Expose-Headers dans le
 * middleware) et met à jour le compteur local si présent.
 */
export function updateTrialFromResponse(res: Response): void {
  const v = res.headers.get('x-trial-remaining')
  if (v === null) return
  const n = parseInt(v, 10)
  if (Number.isFinite(n)) {
    setTrialRemaining(Math.max(0, n))
  }
}
