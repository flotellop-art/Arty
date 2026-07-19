// Hook qui synchronise l'état du plan utilisateur avec /api/subscription/status.
// Re-fetch à chaque appel API réussi (signal `arty-message-sent`) pour que les
// compteurs free se mettent à jour en live dans le badge du ChatTopBar.

import { useState, useEffect, useCallback, useRef } from 'react'
import { getValidAccessToken } from '../services/googleAuth'
import { apiUrl } from '../services/apiBase'
import { fetchWalletBalance, creditsCoverPremium } from '../services/walletClient'
import { getActiveUserId } from '../services/userSession'

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
}

interface ApiResponse {
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
}

const ALL_FAMILIES: ModelFamily[] = [
  'claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium',
  'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full',
]

export function usePlanStatus(): PlanStatus & { refresh: () => void } {
  const [state, setState] = useState<PlanStatus>(DEFAULT_STATUS)
  const refreshSerialRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++refreshSerialRef.current
    const requestUserId = getActiveUserId()
    const isCurrentRequest = () =>
      requestId === refreshSerialRef.current && getActiveUserId() === requestUserId
    try {
      const token = await getValidAccessToken()
      if (!token) {
        if (isCurrentRequest()) setState((s) => ({ ...s, loading: false }))
        return
      }
      const res = await fetch(apiUrl('/api/subscription/status'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        if (isCurrentRequest()) setState((s) => ({ ...s, loading: false }))
        return
      }
      const data = (await res.json()) as ApiResponse
      // Crédits prépayés : un user 'free' (essai épuisé ou vrai free) AVEC des
      // crédits peut payer N'IMPORTE QUEL modèle via le wallet → on débloque
      // toutes les familles côté UI. `fetchWalletBalance` met aussi le solde en
      // cache pour aiRouter. Pendant un essai ENCORE actif, `creditsCoverPremium()`
      // est false → le premium reste verrouillé (le serveur force Haiku — « essai
      // gratuit d'abord »).
      const walletBalance = await fetchWalletBalance()
      if (!isCurrentRequest()) return
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
      setState({
        plan: data.plan,
        allowedFamilies: effectiveFamilies,
        lockedFamilies: effectiveLockedFamilies,
        dailyRemaining: data.daily_remaining,
        dailyLimits: data.daily_limits,
        monthlyCap: data.monthly_cap ?? null,
        premiumPackRemaining: data.premium_pack_remaining ?? 0,
        loading: false,
      })
    } catch {
      if (isCurrentRequest()) setState((s) => ({ ...s, loading: false }))
    }
  }, [])

  useEffect(() => {
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
    return () => {
      // Toute réponse encore en vol après un unmount devient obsolète et ne
      // peut plus écrire les caches globaux.
      refreshSerialRef.current += 1
      events.forEach((e) => window.removeEventListener(e, refresh))
      window.removeEventListener('focus', handleFocus)
    }
  }, [refresh])

  return { ...state, refresh }
}
