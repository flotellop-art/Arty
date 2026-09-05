import { describe, expect, it, vi } from 'vitest'
import { TEXT_MODELS, TEXT_DEFAULTS, CHAT_PROVIDERS, findTextModel } from '../../services/modelCatalog'
import { MODEL_OPTIONS } from '../../services/modelSelector'
import { MODEL_COSTS } from '../../services/costTracker'
import { isModelAllowedInTrial } from '../../../functions/api/_lib/checkAllowedUser'
import { panelAccess } from '../../services/comparator/access'
import type { PlanStatus } from '../../hooks/usePlanStatus'
import { estimateCostEur } from '../../services/comparator/tokenEstimator'
import { createModelReporter, formatModelName, getLastModelAttribution } from '../../services/modelLabels'

const paid = [...new Set(TEXT_MODELS.map(m => m.family))] as PlanStatus['allowedFamilies']
const plan = (extra: Partial<PlanStatus> = {}): PlanStatus => ({ plan: 'free', allowedFamilies: ['claude-haiku'], lockedFamilies: [], loading: false,
  statusUnavailable: false, authRequired: false, authRejected: false, dailyRemaining: null, dailyLimits: null, monthlyCap: null, premiumPackRemaining: 0, ...extra })
const config = (modelId = 'claude-haiku-4-5') => ({ id: 'a', provider: TEXT_MODELS.find(m => m.modelId === modelId)!.provider, modelId })
const access = (modelId: string, extra: Partial<PlanStatus> = {}, personalKey = false, trialRemaining: number | null = null) => panelAccess(config(modelId), {
  plan: plan(extra), personalKey, trialRemaining, authenticated: true,
})
describe('Shared catalogue invariants', () => {
  it('adapts provider preferences without migrating persisted IDs', () => {
    expect(MODEL_OPTIONS.map(m => m.id)).toEqual(['auto', ...CHAT_PROVIDERS.map(p => p.id)])
    expect(new Set(TEXT_MODELS.map(m => `${m.provider}:${m.modelId}`)).size).toBe(TEXT_MODELS.length)
  })
  it.each(Object.values(TEXT_DEFAULTS))('configured default %s resolves to an explicit priced entry', id => {
    const model = TEXT_MODELS.find(m => m.modelId === id || m.responseIds?.includes(id))!
    expect(model).toBeDefined()
    expect(Object.hasOwn(MODEL_COSTS, model.costKey)).toBe(true)
  })
  it.each(TEXT_MODELS)('$modelId trial eligibility agrees with the existing server', m => {
    expect(m.trial).toBe(isModelAllowedInTrial(m.modelId))
    expect(formatModelName(m.modelId)).toBe(m.label)
  })
  it('never estimates unknown versions from a permissive prefix', () => {
    expect(findTextModel('openai', 'gpt-99')).toBeUndefined()
    expect(estimateCostEur('gpt-99', 100, 100)).toBeNull()
    expect(estimateCostEur('gpt-5', NaN, 100)).toBeNull()
    expect(estimateCostEur('gpt-5', 0, 0)).toBe(0)
  })
  it.each([['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['claude-sonnet-4-6', 'Claude Sonnet 4.6'], ['mistral-medium-2505', 'Mistral Medium'], ['mistral-medium-latest', 'Mistral Medium'], ['gpt-5.6-terra', 'GPT-5.6 Terra'], ['unknown-id', 'unknown-id']])('keeps old labels for %s', (id, label) => {
    expect(formatModelName(id!)).toBe(label)
    expect(getLastModelAttribution([{ role: 'assistant', model: id }, { role: 'assistant' }])).toBeNull()
  })
})
describe('Eligibility is not a server entitlement grant', () => {
  it.each(['subscription', 'vip'] as const)('%s uses verified allowed families', p => {
    for (const m of TEXT_MODELS) expect(access(m.modelId, { plan: p, allowedFamilies: paid })).toBeNull()
  })
  it('keeps a true free Haiku usable with a second BYOK provider, unlike an exhausted trial', () => {
    expect(access('claude-haiku-4-5')).toBeNull()
    expect(access('claude-haiku-4-5', {}, false, 0)).toBe('compare.access.plan')
    expect(access('gemini-3.5-flash', {}, true)).toBeNull()
    expect(access('gemini-3.5-flash')).toBe('compare.access.plan')
  })
  it('active trial uses its own allowlist even when the plan cache says free', () => {
    for (const m of TEXT_MODELS) expect(access(m.modelId, {}, false, 20)).toBe(m.trial ? null : 'compare.access.trial')
  })
  it('wallet-unlocked free is distinct from active trial', () => {
    expect(access('gpt-5.6-terra', { allowedFamilies: paid }, false, 0)).toBeNull()
    expect(access('gpt-5.6-terra', { allowedFamilies: paid }, false, 20)).toBe('compare.access.trial')
  })
  it('Pro still requires its own key despite all displayed families', () => {
    expect(access('gpt-5.6-terra', { plan: 'pro', allowedFamilies: paid })).toBe('compare.access.byok')
    expect(access('gpt-5.6-terra', { plan: 'pro', allowedFamilies: paid }, true)).toBeNull()
  })
  it.each(['loading', 'statusUnavailable'] as const)('unknown %s is not a server grant but does not reject BYOK', field => {
    expect(access('gpt-5', { plan: 'vip', allowedFamilies: paid, [field]: true })).toBe('compare.access.unverified')
    expect(access('gpt-5', { [field]: true }, true)).toBeNull()
  })
  it.each(['authRejected', 'authRequired'] as const)('invalid auth %s also blocks BYOK', field => {
    expect(access('gpt-5', { [field]: true }, true)).toBe('compare.access.auth')
  })
})
describe('Local model reporter', () => {
  it('reports equal IDs as provider-confirmed, proxy as proxy, and no metadata as requested', () => {
    const callback = vi.fn(), reporter = createModelReporter({ onModelUsed: callback }, 'gpt-5')
    reporter({ model: 'gpt-5', provider: 'openai' })
    reporter({ model: 'gpt-5', provider: 'openai', confirmed: true })
    reporter({ model: 'gpt-5', provider: 'openai', source: 'proxy' })
    expect(callback.mock.calls.map(c => c[0].source)).toEqual(['requested', 'provider', 'proxy'])
  })
  it('ignores malformed metadata and rejects obsolete sessions', () => {
    const callback = vi.fn()
    createModelReporter({ onModelUsed: callback }, 'gpt-5')({ model: '<script>', provider: 'openai', confirmed: true })
    expect(callback).not.toHaveBeenCalled()
    expect(() => createModelReporter({ assertRequestCurrent: () => { throw new Error('stale') } }, 'gpt-5')({ model: 'gpt-5', provider: 'openai' })).toThrow('stale')
  })
})
