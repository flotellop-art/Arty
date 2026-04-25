/**
 * Trial client — facade pour le plan d'essai gratuit (30 messages).
 *
 * Fournit :
 *   - `initTrial(accessToken)` : appelé une fois après le sign-in Google.
 *     Touche `POST /api/trial/init` côté backend, qui crée la ligne
 *     subscriptions D1 + le compteur KV pour les nouveaux users, ou
 *     retourne le plan existant si déjà connu (idempotent).
 *   - `getOnboardingSplash()` / `clearOnboardingSplash()` : pour que App.tsx
 *     décide d'afficher le splash VIP ou l'intro Trial juste après le login.
 *   - `getTrialRemaining()` / `setTrialRemaining(n)` : compteur affiché dans
 *     la bannière, mis à jour à chaque réponse IA via le header
 *     `x-trial-remaining` lu par les AI clients.
 *
 * État stocké en localStorage NON scopé par user — on en a besoin AVANT
 * la création de la session Arty (entre la fin du login Google et le
 * setActiveSession). Acceptable parce que c'est juste un compteur public,
 * pas de PII ni de token.
 */

import { apiUrl } from './apiBase'

const SPLASH_KEY = 'arty-trial-onboarding-splash'
const SPLASH_SHOWN_KEY = 'arty-trial-onboarding-splash-shown'
const REMAINING_KEY = 'arty-trial-remaining'

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
export async function initTrial(accessToken: string): Promise<TrialInitResponse | null> {
  if (!accessToken) return null
  try {
    const res = await fetch(apiUrl('/api/trial/init'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) return null
    const data = (await res.json()) as TrialInitResponse

    // Le splash post-login (VIP welcome, trial intro) ne doit s'afficher
    // qu'une seule fois par device — `SPLASH_SHOWN_KEY` est posé quand
    // l'utilisateur dismiss le splash (`clearOnboardingSplash`). Sans ce
    // garde-fou, un user trial qui se déconnecte/reconnecte reverrait
    // l'intro à chaque sign-in.
    const splashAlreadyShown = localStorage.getItem(SPLASH_SHOWN_KEY) === '1'

    if (data.plan === 'vip') {
      if (!splashAlreadyShown) localStorage.setItem(SPLASH_KEY, 'vip')
      // VIPs n'ont pas de compteur — on nettoie au cas où.
      localStorage.removeItem(REMAINING_KEY)
    } else if (data.plan === 'trial') {
      if (!splashAlreadyShown) localStorage.setItem(SPLASH_KEY, 'trial')
      if (typeof data.trial_messages_remaining === 'number') {
        localStorage.setItem(REMAINING_KEY, String(data.trial_messages_remaining))
      }
    } else {
      // Plan déjà actif (subscription/pro) ou free → pas de splash, pas de
      // compteur trial.
      localStorage.removeItem(SPLASH_KEY)
      localStorage.removeItem(REMAINING_KEY)
    }
    return data
  } catch {
    return null
  }
}

export function getOnboardingSplash(): SplashState {
  const v = localStorage.getItem(SPLASH_KEY)
  if (v === 'vip' || v === 'trial') return v
  return null
}

export function clearOnboardingSplash(): void {
  localStorage.removeItem(SPLASH_KEY)
  localStorage.setItem(SPLASH_SHOWN_KEY, '1')
}

export function getTrialRemaining(): number | null {
  const raw = localStorage.getItem(REMAINING_KEY)
  if (raw === null) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? Math.max(0, n) : null
}

/**
 * Met à jour le compteur trial. Appelé par les AI clients après chaque
 * réponse, en lisant le header `x-trial-remaining` du proxy. Émet un
 * CustomEvent pour que la bannière React se rafraîchisse sans avoir à
 * polling localStorage.
 */
export function setTrialRemaining(n: number): void {
  localStorage.setItem(REMAINING_KEY, String(Math.max(0, n)))
  try {
    window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed', { detail: { remaining: n } }))
  } catch {
    // CustomEvent peut échouer dans certains environnements de test ; ignore.
  }
}

export function clearTrialRemaining(): void {
  localStorage.removeItem(REMAINING_KEY)
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
