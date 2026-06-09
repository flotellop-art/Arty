import { describe, it, expect, beforeEach, vi } from 'vitest'

// Isole walletClient de ses deps lourdes (réseau/Capacitor) — on ne teste que
// la logique d'éligibilité premium, qui dépend du cache solde + du compteur essai.
let trialRemaining: number | null = null
vi.mock('../../services/trialClient', () => ({ getTrialRemaining: () => trialRemaining }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: async () => null }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))

import { creditsCoverPremium, getCachedWalletAvailableMicro } from '../../services/walletClient'

function setWallet(micro: number | null) {
  if (micro === null) localStorage.removeItem('arty-wallet-available')
  else localStorage.setItem('arty-wallet-available', String(micro))
}

describe('creditsCoverPremium — débloque le premium seulement APRÈS l\'essai gratuit', () => {
  beforeEach(() => {
    trialRemaining = null
    localStorage.clear()
  })

  it('false sans crédits', () => {
    setWallet(0)
    expect(creditsCoverPremium()).toBe(false)
  })

  // Cœur de la priorité "essai gratuit d'abord" : pendant l'essai, pas de premium
  // via crédits (le serveur force Haiku de toute façon).
  it('false avec crédits MAIS essai encore actif (restant > 0)', () => {
    setWallet(40_000_000)
    trialRemaining = 12
    expect(creditsCoverPremium()).toBe(false)
  })

  it('true avec crédits + essai épuisé (restant 0)', () => {
    setWallet(40_000_000)
    trialRemaining = 0
    expect(creditsCoverPremium()).toBe(true)
  })

  it('true avec crédits + jamais d\'essai (null = vrai free)', () => {
    setWallet(40_000_000)
    trialRemaining = null
    expect(creditsCoverPremium()).toBe(true)
  })

  it('getCachedWalletAvailableMicro lit le cache (et 0 si absent/invalide)', () => {
    setWallet(123_456)
    expect(getCachedWalletAvailableMicro()).toBe(123_456)
    setWallet(null)
    expect(getCachedWalletAvailableMicro()).toBe(0)
  })
})
