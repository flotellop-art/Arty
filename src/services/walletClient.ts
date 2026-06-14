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
// Cache du flag « cet user a un wallet » — sert à n'afficher qu'UNE unité de
// coût (crédits) pour les users prépayés : le CostIndicator (coût fournisseur
// en ~$, non markupé) est masqué pour eux, sinon il diverge du solde crédits et
// EXPOSE le markup (P1.7, audit 14 juin).
const WALLET_HAS_KEY = 'arty-wallet-has'

// 1 crédit AFFICHÉ = 1 cent US (10 000 micro-USD). Choix de PRÉSENTATION
// centralisé ICI (avant : dupliqué dans WalletBadge) — une seule source pour
// toutes les surfaces qui convertissent µ$ ↔ crédits.
export const MICRO_PER_CREDIT = 10_000

/** Convertit un montant en micro-USD en crédits affichés (arrondi bas). */
export function microToCredits(micro: number): number {
  return Math.max(0, Math.floor((Number.isFinite(micro) ? micro : 0) / MICRO_PER_CREDIT))
}

/** Vrai si le dernier fetch a vu un wallet (lecture synchrone, sans hook). */
export function hasWalletCached(): boolean {
  try {
    return localStorage.getItem(WALLET_HAS_KEY) === '1'
  } catch {
    return false
  }
}

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
      localStorage.setItem(WALLET_HAS_KEY, data.hasWallet ? '1' : '0')
    } catch {
      /* storage indispo — non bloquant */
    }
    return data
  } catch {
    return null
  }
}
