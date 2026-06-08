import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'

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

export async function fetchWalletBalance(): Promise<WalletBalance | null> {
  const token = await getValidAccessToken()
  if (!token) return null
  try {
    const resp = await fetch(apiUrl('/api/wallet/balance'), {
      method: 'GET',
      headers: { 'x-google-token': token },
    })
    if (!resp.ok) return null
    return (await resp.json()) as WalletBalance
  } catch {
    return null
  }
}
