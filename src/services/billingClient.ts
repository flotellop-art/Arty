import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'
import type { BillingUsage } from './billingAdvisor'

/**
 * Récupère l'usage 30 jours pour le conseiller de facturation. La forme renvoyée
 * par GET /api/billing/usage correspond exactement à l'entrée du cerveau
 * (decideBillingAdvice) — le calcul de la reco se fait ensuite côté client.
 */
export async function fetchBillingUsage(): Promise<BillingUsage | null> {
  const token = await getValidAccessToken()
  if (!token) return null
  try {
    const resp = await fetch(apiUrl('/api/billing/usage'), {
      method: 'GET',
      headers: { 'x-google-token': token },
    })
    if (!resp.ok) return null
    return (await resp.json()) as BillingUsage
  } catch {
    return null
  }
}
