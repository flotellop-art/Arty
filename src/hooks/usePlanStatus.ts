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
  | 'mistral-small'
  | 'mistral-medium'
  | 'gemini-flash'
  | 'gemini-pro'
  | 'gpt-mini'
  | 'gpt-full'

export interface PlanStatus {
  plan: PlanType
  allowedFamilies: ModelFamily[]
  lockedFamilies: ModelFamily[]
  dailyRemaining: Partial<Record<ModelFamily, number>> | null
  dailyLimits: Partial<Record<ModelFamily, number>> | null
  loading: boolean
}

interface ApiResponse {
  plan: PlanType
  allowed_families: ModelFamily[]
  locked_families: ModelFamily[]
  daily_remaining: Partial<Record<ModelFamily, number>> | null
  daily_limits: Partial<Record<ModelFamily, number>> | null
}

const DEFAULT_STATUS: PlanStatus = {
  plan: 'free',
  allowedFamilies: ['claude-haiku', 'mistral-small'],
  lockedFamilies: ['claude-sonnet', 'claude-opus', 'mistral-medium', 'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full'],
  dailyRemaining: { 'claude-haiku': 10, 'mistral-small': 5 },
  dailyLimits: { 'claude-haiku': 10, 'mistral-small': 5 },
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
    return () => events.forEach((e) => window.removeEventListener(e, refresh))
  }, [refresh])

  return { ...state, refresh }
}
