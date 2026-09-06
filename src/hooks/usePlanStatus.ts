// Hook qui synchronise l'état du plan utilisateur avec /api/subscription/status.
// Re-fetch à chaque appel API réussi (signal `arty-message-sent`) pour que les
// compteurs free se mettent à jour en live dans le badge du ChatTopBar.

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getStoredTokens,
  getValidAccessToken,
  isGoogleStorageReady,
} from '../services/googleAuth'
import { apiUrl } from '../services/apiBase'
import { fetchWalletBalance, creditsCoverPremium } from '../services/walletClient'
import {
  getActiveSession,
  getActiveSessionEpoch,
  getActiveUserId,
} from '../services/userSession'

export type PlanType = 'free' | 'subscription' | 'pro' | 'vip'

export type ModelFamily =
  | 'claude-haiku'
  | 'claude-sonnet'
  | 'claude-opus'
  | 'mistral-medium'
  | 'gemini-flash'
  | 'gemini-pro'
  | 'gpt-mini'
  | 'gpt-full'

/** Compteur mensuel d'un bucket premium (plan subscription) — P0.6. */
export interface MonthlyCapEntry {
  used: number
  limit: number
  remaining: number
}

export interface PlanStatus {
  plan: PlanType
  allowedFamilies: ModelFamily[]
  lockedFamilies: ModelFamily[]
  dailyRemaining: Partial<Record<ModelFamily, number>> | null
  dailyLimits: Partial<Record<ModelFamily, number>> | null
  /** Compteurs mensuels premium par bucket ('claude-sonnet' | 'gpt-5' |
      'gemini-pro'). null hors plan subscription. */
  monthlyCap: Record<string, MonthlyCapEntry> | null
  /** Solde du Pack Premium (+100 messages) acheté, 0 sinon. */
  premiumPackRemaining: number
  loading: boolean
  /**
   * Le serveur a REFUSÉ le token Google (audience ≠ Arty, token invalide,
   * e-mail non vérifié) : le plan affiché est un repli, pas une vérité.
   * Sans ce drapeau, un compte VIP voyait « Gratuit » sans aucun indice —
   * terrain du 10 août 2026. À afficher comme « reconnecte ton compte Google »,
   * jamais comme un vrai plan gratuit.
   */
  authRejected: boolean
  /** Session Google connue, mais plus aucun grant n'est disponible. */
  authRequired: boolean
  /** Le plan n'a pas pu être vérifié à cause d'un échec réseau/serveur. */
  statusUnavailable: boolean
}

interface ApiResponse {
  auth?: 'ok' | 'no_token' | 'token_rejected' | 'unavailable'
  plan: PlanType
  allowed_families: ModelFamily[]
  locked_families: ModelFamily[]
  daily_remaining: Partial<Record<ModelFamily, number>> | null
  daily_limits: Partial<Record<ModelFamily, number>> | null
  monthly_cap?: Record<string, MonthlyCapEntry> | null
  premium_pack_remaining?: number
}

const DEFAULT_STATUS: PlanStatus = {
  plan: 'free',
  allowedFamilies: ['claude-haiku'],
  lockedFamilies: ['claude-sonnet', 'claude-opus', 'mistral-medium', 'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full'],
  dailyRemaining: { 'claude-haiku': 10 },
  dailyLimits: { 'claude-haiku': 10 },
  monthlyCap: null,
  premiumPackRemaining: 0,
  loading: true,
  authRejected: false,
  authRequired: false,
  statusUnavailable: false,
}

const ALL_FAMILIES: ModelFamily[] = [
  'claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium',
  'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full',
]

function clearVerifiedPlanCache(): void {
  try { localStorage.removeItem('arty-plan-cache') } catch { /* noop */ }
  try { localStorage.removeItem('arty-allowed-families') } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('arty-plan-status-changed')) } catch { /* noop */ }
}

function cacheFreePlan(): void {
  try { localStorage.setItem('arty-plan-cache', 'free') } catch { /* noop */ }
  try {
    localStorage.setItem('arty-allowed-families', JSON.stringify(['claude-haiku']))
  } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('arty-plan-status-changed')) } catch { /* noop */ }
}

function unverifiedStatus(
  reason: 'authRejected' | 'authRequired' | 'statusUnavailable',
): PlanStatus {
  return {
    ...DEFAULT_STATUS,
    loading: false,
    authRejected: reason === 'authRejected',
    authRequired: reason === 'authRequired',
    statusUnavailable: reason === 'statusUnavailable',
  }
}

interface SharedPlanRefresh {
  userId: string | null
  sessionEpoch: number
  promise: Promise<PlanStatus | null>
}

// Plusieurs écrans montent ce hook en parallèle. Une seule vérification
// réseau/token doit toutefois tourner à la fois pour un même compte : au
// retour d'une PWA, focus + pageshow + visibilitychange arrivent souvent dans
// la même rafale et getValidAccessToken invalide volontairement les refresh
// concurrents.
let sharedPlanRefresh: SharedPlanRefresh | null = null

async function resolvePlanStatus(
  requestUserId: string | null,
  requestSessionEpoch: number,
): Promise<PlanStatus | null> {
  const isCurrentUser = () =>
    getActiveUserId() === requestUserId
    && getActiveSessionEpoch() === requestSessionEpoch
  try {
    const token = await getValidAccessToken()
    if (!isCurrentUser()) return null

    if (!token) {
      const authMethod = getActiveSession()?.authMethod
      const googleSession = authMethod === 'google'
      // Au cold boot, les tokens chiffrés ne sont pas encore dans le cache
      // mémoire. `google-storage-ready` relancera ce hook : garder le badge
      // masqué jusque-là évite un faux « reconnecte-toi » d'une frame.
      if (googleSession && !isGoogleStorageReady()) return null

      if (googleSession) {
        // Aucun grant après bootstrap = reconnexion nécessaire (migration de
        // scopes, révocation ou logout Google). Un grant encore stocké mais
        // momentanément impossible à rafraîchir = panne transitoire.
        const hasStoredGrant = getStoredTokens() !== null
        if (!hasStoredGrant) clearVerifiedPlanCache()
        return unverifiedStatus(hasStoredGrant ? 'statusUnavailable' : 'authRequired')
      }

      // Une session email/API-key ne peut pas hériter d'un état VIP React
      // chargé par le compte Google précédent. L'essai email doit toutefois
      // conserver un cache Free explicite : le routeur choisit alors Haiku
      // directement au lieu d'afficher Sonnet puis de subir un swap serveur.
      if (authMethod === 'email') cacheFreePlan()
      else clearVerifiedPlanCache()
      return { ...DEFAULT_STATUS, loading: false }
    }

    const res = await fetch(apiUrl('/api/subscription/status'), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!isCurrentUser()) return null
    if (!res.ok) return unverifiedStatus('statusUnavailable')

    const data = (await res.json()) as ApiResponse
    if (!isCurrentUser()) return null
    // Repli explicite plutôt que silencieux : le plan renvoyé n'est pas
    // fiable tant que l'identité n'est pas prouvée.
    if (data.auth === 'token_rejected') {
      console.warn('[plan] token Google refusé par le serveur — plan affiché non fiable')
      clearVerifiedPlanCache()
      return unverifiedStatus('authRejected')
    }
    if (data.auth === 'no_token') {
      clearVerifiedPlanCache()
      return unverifiedStatus('authRequired')
    }

    // Crédits prépayés : un user 'free' (essai épuisé ou vrai free) AVEC des
    // crédits peut payer N'IMPORTE QUEL modèle via le wallet → on débloque
    // toutes les familles côté UI. `fetchWalletBalance` met aussi le solde en
    // cache pour aiRouter. Pendant un essai ENCORE actif, `creditsCoverPremium()`
    // est false → le premium reste verrouillé (le serveur force Haiku — « essai
    // gratuit d'abord »).
    const walletBalance = await fetchWalletBalance()
    if (!isCurrentUser()) return null
    // Un échec wallet est fermé par défaut : ne jamais réutiliser un solde
    // local ancien pour ouvrir les familles premium.
    const unlock = data.plan === 'free' && walletBalance !== null && creditsCoverPremium()
    const effectiveFamilies = unlock ? [...ALL_FAMILIES] : data.allowed_families
    const effectiveLockedFamilies = unlock ? [] : data.locked_families
    // F-14 (refonte routage, étape 3) — cache aussi les FAMILLES autorisées
    // pour le routage auto hors React (router/availability.ts) : un abonné
    // clé-serveur peut atteindre Gemini/Mistral selon son plan, plus
    // seulement selon ses clés BYOK. Même valeur que l'état UI (unlock
    // wallet inclus) pour ne jamais afficher débloqué et router verrouillé.
    try {
      // Commit atomique logique après TOUS les awaits : plan et familles
      // appartiennent forcément au même compte et à la même réponse.
      localStorage.setItem('arty-plan-cache', data.plan)
      localStorage.setItem(
        'arty-allowed-families',
        JSON.stringify(effectiveFamilies)
      )
    } catch {}
    // Le composer calcule une destination avant envoi hors React context.
    // Notifier après le commit plan+familles évite d'afficher Terra avec un
    // entitlement expiré (ou Claude juste après un achat) jusqu'à la frappe.
    try {
      window.dispatchEvent(new CustomEvent('arty-plan-status-changed'))
    } catch {}
    return {
      plan: data.plan,
      allowedFamilies: effectiveFamilies,
      lockedFamilies: effectiveLockedFamilies,
      dailyRemaining: data.daily_remaining,
      dailyLimits: data.daily_limits,
      monthlyCap: data.monthly_cap ?? null,
      premiumPackRemaining: data.premium_pack_remaining ?? 0,
      loading: false,
      // Réponse identifiée : lève un éventuel drapeau posé par un
      // rafraîchissement précédent (token réparé entre-temps).
      authRejected: false,
      authRequired: false,
      statusUnavailable: false,
    }
  } catch {
    return isCurrentUser() ? unverifiedStatus('statusUnavailable') : null
  }
}

function getSharedPlanRefresh(
  userId: string | null,
  sessionEpoch: number,
): Promise<PlanStatus | null> {
  if (
    sharedPlanRefresh?.userId === userId
    && sharedPlanRefresh.sessionEpoch === sessionEpoch
  ) return sharedPlanRefresh.promise

  const task: SharedPlanRefresh = {
    userId,
    sessionEpoch,
    promise: Promise.resolve(null),
  }
  task.promise = resolvePlanStatus(userId, sessionEpoch).finally(() => {
    if (sharedPlanRefresh === task) sharedPlanRefresh = null
  })
  sharedPlanRefresh = task
  return task.promise
}

export function usePlanStatus(enabled = true): PlanStatus & { refresh: () => void } {
  const [state, setState] = useState<PlanStatus>(DEFAULT_STATUS)
  const enabledRef = useRef(enabled); enabledRef.current = enabled
  const refreshSerialRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return
    const requestId = ++refreshSerialRef.current
    const requestUserId = getActiveUserId()
    const requestSessionEpoch = getActiveSessionEpoch()
    const nextState = await getSharedPlanRefresh(requestUserId, requestSessionEpoch)
    if (
      nextState
      && enabledRef.current
      && requestId === refreshSerialRef.current
      && getActiveUserId() === requestUserId
      && getActiveSessionEpoch() === requestSessionEpoch
    ) {
      setState(nextState)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    // Re-sync sur événements custom : `arty-message-sent` (après chaque
    // message → décrémenter le compteur en live), `google-storage-ready`
    // (après un login Google → refetch avec le nouveau token).
    const events = ['arty-message-sent', 'google-storage-ready']
    events.forEach((e) => window.addEventListener(e, refresh))
    // H-Plan-3 (audit étape 5) — refresh au focus de la window. Cas typique :
    // user se logge free, achète Pro dans un autre onglet (webhook Lemon
    // Squeezy update D1), revient sur Arty → sans cette ligne le cache
    // 'arty-plan-cache' reste à 'free' jusqu'au prochain message, et le
    // 1er message est servi en Haiku au lieu de Sonnet (cf. selectClaudeSubModel).
    const handleFocus = () => void refresh()
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleFocus)
    window.addEventListener('pageshow', handleFocus)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      // Toute réponse encore en vol après un unmount devient obsolète et ne
      // peut plus écrire les caches globaux.
      refreshSerialRef.current += 1
      events.forEach((e) => window.removeEventListener(e, refresh))
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleFocus)
      window.removeEventListener('pageshow', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh, enabled])

  return { ...state, refresh }
}
