import { describe, it, expect, beforeEach, vi } from 'vitest'

// Le toggle explicite vit dans scopedStorage (clé scopée par session). On le
// contrôle via une variable plutôt que de monter une session.
let enabledStored: string | null = null
vi.mock('../../services/scopedStorage', () => ({
  getItem: (k: string) => (k === 'proactive-brief-enabled' ? enabledStored : null),
  setItem: vi.fn(),
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}))

// getTrialRemaining() lit le compteur d'essai mis en cache ; on le pilote.
let trialRemaining: number | null = null
vi.mock('../../services/trialClient', () => ({
  getTrialRemaining: () => trialRemaining,
}))

import { isProactiveBriefEnabled } from '../../services/proactiveBriefSettings'

function setPlanCache(plan: string | null) {
  if (plan === null) localStorage.removeItem('arty-plan-cache')
  else localStorage.setItem('arty-plan-cache', plan)
}

describe('isProactiveBriefEnabled — défaut dépendant du plan + opt-in', () => {
  beforeEach(() => {
    enabledStored = null
    trialRemaining = null
    localStorage.clear()
  })

  // Le cœur du bug : un user en ESSAI ne doit PAS déclencher le brief auto par
  // défaut (sinon 1 message/jour grillé sans qu'il l'ait demandé).
  it('défaut OFF pour un user en essai (getTrialRemaining non-null)', () => {
    trialRemaining = 25
    setPlanCache('free') // l'essai est mappé en 'free' par /subscription/status
    expect(isProactiveBriefEnabled()).toBe(false)
  })

  it('défaut OFF pour un user free', () => {
    setPlanCache('free')
    expect(isProactiveBriefEnabled()).toBe(false)
  })

  // Sécurité : tant que le plan n'est pas chargé, on n'active pas (pas de
  // dépense de quota sur une incertitude).
  it('défaut OFF tant que le plan est inconnu (cache nul)', () => {
    setPlanCache(null)
    expect(isProactiveBriefEnabled()).toBe(false)
  })

  it('défaut ON pour un plan payant confirmé', () => {
    for (const p of ['subscription', 'pro', 'vip']) {
      setPlanCache(p)
      expect(isProactiveBriefEnabled()).toBe(true)
    }
  })

  // « option activable » : un user essai/free peut l'activer explicitement.
  it('le toggle ON prime même en essai (opt-in)', () => {
    enabledStored = 'true'
    trialRemaining = 25
    expect(isProactiveBriefEnabled()).toBe(true)
  })

  it('le toggle OFF prime même pour un payant (opt-out)', () => {
    enabledStored = 'false'
    setPlanCache('subscription')
    expect(isProactiveBriefEnabled()).toBe(false)
  })
})
