import { describe, it, expect } from 'vitest'
import {
  planUsesServerKey,
  proKeyRequiredResponse,
  type PlanType,
} from '../../../functions/api/_lib/checkAllowedUser'

// Verrou de régression sur la politique « Pro = BYOK » (P2.5, vigie 14 juin) :
// une licence Pro à vie donne l'APP, jamais l'accès à la clé serveur d'Arty —
// sinon un achat unique à 39 € = accès IA serveur illimité à vie (trou de marge).
describe('planUsesServerKey — Pro = BYOK', () => {
  it('refuse la clé serveur UNIQUEMENT au plan pro', () => {
    expect(planUsesServerKey('pro')).toBe(false)
  })

  it('laisse les autres plans utiliser la clé serveur (soumis à leurs quotas)', () => {
    const allowed: PlanType[] = ['subscription', 'vip', 'trial', 'free']
    for (const plan of allowed) {
      expect(planUsesServerKey(plan)).toBe(true)
    }
  })
})

describe('proKeyRequiredResponse', () => {
  it('renvoie un 403 avec le code stable pro_byok_required', async () => {
    const res = proKeyRequiredResponse()
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string; message?: string }
    expect(body.error).toBe('pro_byok_required')
    expect(typeof body.message).toBe('string')
  })
})
