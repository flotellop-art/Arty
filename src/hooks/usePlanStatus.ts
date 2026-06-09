// Hook qui synchronise l'état du plan utilisateur avec /api/subscription/status.
// Re-fetch à chaque appel API réussi (signal `arty-message-sent`) pour que les
// compteurs free se mettent à jour en live dans le badge du ChatTopBar.

import { useState, useEffect, useCallback } from 'react'
import { getValidAccessToken } from '../services/googleAuth'
import { apiUrl } from '../services/apiBase'
import { fetchWalletBalance, creditsCoverPremium } from '../services/walletClient'

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
  allowedFamilies: ['claude-haiku'],
  lockedFamilies: ['claude-sonnet', 'claude-opus', 'mistral-medium', 'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full'],
  dailyRemaining: { 'claude-haiku': 10 },
  dailyLimits: { 'claude-haiku': 10 },
  loading: true,
}

const ALL_FAMILIES: ModelFamily[] = [
  'claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium',
  'gemini-flash', 'gemini-pro', 'gpt-mini', 'gpt-full',
]

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
      // Cache le plan en localStorage pour que les services non-React
      // (anthropicClient, aiRouter) puissent l'utiliser sans hook React.
      try { localStorage.setItem('arty-plan-cache', data.plan) } catch {}
      // Crédits prépayés : un user 'free' (essai épuisé ou vrai free) AVEC des
      // crédits peut payer N'IMPORTE QUEL modèle via le wallet → on débloque
      // toutes les familles côté UI. `fetchWalletBalance` met aussi le solde en
      // cache pour aiRouter. Pendant un essai ENCORE actif, `creditsCoverPremium()`
      // est false → le premium reste verrouillé (le serveur force Haiku — « essai
      // gratuit d'abord »).
      await fetchWalletBalance()
      const unlock = data.plan === 'free' && creditsCoverPremium()
      setState({
        plan: data.plan,
        allowedFamilies: unlock ? [...ALL_FAMILIES] : data.allowed_families,
        lockedFamilies: unlock ? [] : data.locked_families,
        dailyRemaining: data.daily_remaining,
        dailyLimits: data.daily_limits,
        loading: false,
      })
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
