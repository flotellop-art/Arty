import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'
import { getTrialRemaining } from './trialClient'

// Client pour le solde de crédits prépayés (GET /api/wallet/balance).
// Tout est en micro-USD côté serveur ; la conversion en "crédits" affichés est
// un choix de présentation (voir MICRO_PER_CREDIT dans WalletBadge).

export interface WalletBalance {
  hasWallet: boolean
  balanceMicro: number
  reservedMicro: number
  /** Solde réellement disponible (balance - réservations en vol). */
  availableMicro: number
}

// Cache synchrone du solde disponible : les services non-React (aiRouter) en ont
// besoin sans hook. Rafraîchi à chaque fetch (WalletBadge + usePlanStatus).
const WALLET_CACHE_KEY = 'arty-wallet-available'

export function getCachedWalletAvailableMicro(): number {
  try {
    const n = Number(localStorage.getItem(WALLET_CACHE_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/**
 * L'utilisateur peut-il payer un modèle PREMIUM avec ses crédits MAINTENANT ?
 * = il a des crédits ET n'est PAS sur un essai gratuit encore actif.
 * Pendant l'essai (restant > 0), le serveur force Haiku (« essai gratuit
 * d'abord ») → on ne débloque pas le premium. Le wallet ne prend la main que
 * quand l'essai est épuisé (restant ≤ 0) ou que l'user n'a jamais eu d'essai
 * (getTrialRemaining() === null). Aligne le client sur le routage serveur.
 */
export function creditsCoverPremium(): boolean {
  if (getCachedWalletAvailableMicro() <= 0) return false
  const remaining = getTrialRemaining()
  return remaining === null || remaining <= 0
}

export async function fetchWalletBalance(): Promise<WalletBalance | null> {
  const token = await getValidAccessToken()
  if (!token) return null
  try {
    const resp = await fetch(apiUrl('/api/wallet/balance'), {
      method: 'GET',
      headers: { 'x-google-token': token },
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as WalletBalance
    try {
      localStorage.setItem(WALLET_CACHE_KEY, String(data.availableMicro ?? 0))
    } catch {
      /* storage indispo — non bloquant */
    }
    return data
  } catch {
    return null
  }
}
