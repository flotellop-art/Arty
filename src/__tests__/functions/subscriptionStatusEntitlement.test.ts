// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveStatusEntitlement } from '../../../functions/api/subscription/status'

describe('/subscription/status — priorité des droits', () => {
  it('abonnement actif + licence Pro → subscription (clés serveur ouvertes)', () => {
    expect(resolveStatusEntitlement({
      plan_type: 'subscription',
      status: 'active',
      current_period_end: '2099-01-01T00:00:00Z',
    }, true)).toEqual({ plan: 'subscription', status: 'active' })
  })

  it('abonnement annulé encore payé + licence Pro → subscription', () => {
    expect(resolveStatusEntitlement({
      plan_type: 'subscription',
      status: 'cancelled',
      current_period_end: '2099-01-01T00:00:00Z',
    }, true, Date.parse('2026-07-12T00:00:00Z'))).toEqual({
      plan: 'subscription',
      status: 'cancelled',
    })
  })

  it('abonnement expiré + licence active → Pro ; sans licence → free', () => {
    const expired = {
      plan_type: 'subscription',
      status: 'expired',
      current_period_end: '2026-01-01T00:00:00Z',
    }
    expect(resolveStatusEntitlement(expired, true)).toEqual({ plan: 'pro', status: 'active' })
    expect(resolveStatusEntitlement(expired, false)).toEqual({ plan: 'free', status: 'expired' })
  })
})
