import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanStatus } from '../../hooks/usePlanStatus'
const fixture = vi.hoisted(() => ({ method: 'google', keys: new Set<string>(), trial: 0 as number | null }))
vi.mock('../../services/userSession', () => ({ getActiveSession: () => ({ authMethod: fixture.method }), getActiveUserId: () => 'synthetic-access' }))
vi.mock('../../services/providerLock', () => ({ hasPersonalKey: (provider: string) => fixture.keys.has(provider) }))
vi.mock('../../services/trialClient', () => ({ getTrialRemaining: () => fixture.trial }))
vi.mock('../../services/mailAccounts', () => ({ hasConnectedMailAccounts: () => false }))
vi.mock('../../services/walletClient', () => ({ creditsCoverPremium: () => false }))
import { projectSynthesisAccess } from '../../services/workflows/projectSynthesisAccess'
let plan: PlanStatus
beforeEach(() => {
  localStorage.clear(); fixture.method = 'google'; fixture.keys.clear(); fixture.trial = 0
  plan = { plan: 'vip', allowedFamilies: ['claude-haiku', 'claude-sonnet', 'mistral-medium'], lockedFamilies: [], dailyRemaining: null, dailyLimits: null,
    monthlyCap: null, premiumPackRemaining: 0, loading: false, authRejected: false, authRequired: false, statusUnavailable: false }
})
function access(eu = false) {
  localStorage.setItem('arty-plan-cache', plan.plan); localStorage.setItem('arty-allowed-families', JSON.stringify(plan.allowedFamilies))
  return projectSynthesisAccess(plan, eu, 'Prépare une synthèse des extraits sélectionnés et cite les faits.')
}
describe('guided synthesis access — same routes, no marketing entitlement', () => {
  it.each(['vip', 'subscription'] as const)('opens %s in Claude or Mistral EU', tier => {
    plan.plan = tier
    expect(access()).toMatchObject({ provider: 'anthropic', error: null })
    expect(access(true)).toMatchObject({ provider: 'mistral', error: null })
  })
  it.each(['loading', 'statusUnavailable', 'authRejected', 'authRequired'] as const)('does not disguise %s as a licence to buy', state => {
    plan[state] = true
    expect(access().error).toBe(state.startsWith('auth') ? 'compare.access.auth' : 'compare.access.unverified')
  })
  it('permits email + BYOK without Google, but a rejected Google identity still needs reconnection', () => {
    fixture.method = 'email'; fixture.keys.add('anthropic'); plan.plan = 'pro'; plan.loading = true
    expect(access().error).toBeNull()
    fixture.method = 'google'; plan.authRejected = true
    // aiHttp and the proxies require an authenticated identity even for BYOK.
    expect(access().error).toBe('compare.access.auth')
  })
  it('does not unlock EU from a Claude key or the unconditional Claude availability flag', () => {
    plan.plan = 'pro'; plan.allowedFamilies = []; fixture.keys.add('anthropic')
    expect(access().error).toBeNull(); expect(access(true).error).toBe('compare.access.byok')
    fixture.keys.add('mistral'); expect(access(true).error).toBeNull()
  })
  it('keeps the existing free trial on Claude, and distinguishes exhausted trial', () => {
    plan.plan = 'free'; plan.allowedFamilies = ['claude-haiku']; fixture.trial = 4
    expect(access().error).toBeNull(); expect(access(true).error).not.toBeNull()
    fixture.trial = 0; expect(access().error).toBe('compare.access.plan')
  })
})
