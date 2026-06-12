// Hook qui synchronise l'état du plan utilisateur avec /api/subscription/status.
// Re-fetch à chaque appel API réussi (signal `arty-message-sent`) pour que les
// compteurs free se mettent à jour en live dans le badge du ChatTopBar.

import { useState, useEffect, useCallback } from 'react'
import { getValidAccessToken } from '../services/googleAuth'
import { apiUrl } from '../services/apiBase'

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

export function usePlanStatus(): PlanStatus & { refresh: () => void } {
  const [state, setState] = useState<PlanStatus>(DEFAULT_STATUS)

  const refresh = useCallback(async () => {
    try {
      const token = await getValidAccessToken()
      if (!token) {
        setState((s) => ({ ...s, loading: false }))
        return
      }
      const res = await fetch(apiUrl('/api/subscription/status'), {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false }))
        return
      }
      const data = (await res.json()) as ApiResponse
      setState({
        plan: data.plan,
        allowedFamilies: data.allowed_families,
        lockedFamilies: data.locked_families,
        dailyRemaining: data.daily_remaining,
        dailyLimits: data.daily_limits,
        monthlyCap: data.monthly_cap ?? null,
        premiumPackRemaining: data.premium_pack_remaining ?? 0,
        loading: false,
      })
      // Cache le plan en localStorage pour que les services non-React
      // (anthropicClient, aiRouter) puissent l'utiliser sans hook React.
      try { localStorage.setItem('arty-plan-cache', data.plan) } catch {}
    } catch {
      setState((s) => ({ ...s, loading: false }))
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
      events.forEach((e) => window.removeEventListener(e, refresh))
      window.removeEventListener('focus', handleFocus)
    }
  }, [refresh])

  return { ...state, refresh }
}
