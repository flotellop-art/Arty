import { beforeEach, describe, expect, it, vi } from 'vitest'
const saved = vi.hoisted(() => new Map<string, string>())
vi.mock('../../services/scopedStorage', () => ({ getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) }))
import { resolveRoute } from '../../services/router/resolveRoute'
import { resolveChatModelPreference, setChatModelPreference } from '../../services/chatModelPreference'
import type { RouteInput } from '../../services/router/types'
beforeEach(() => saved.clear())
function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return { originalText: 'Lis mon agenda', selectedModel: 'openai', availability: { claude: true, openai: true, gemini: true, mistral: true },
    plan: { plan: 'subscription', isPro: false, creditsCoverPremium: false }, reflectionLevel: 'auto',
    hasFiles: false, hasImages: false, hasPdf: false, hasOtherFiles: false, euOnly: false, hasPrivateHistory: false, ...overrides }
}
describe('exact chat models', () => {
  it('uses Luna by default in active trial and rejects a saved Terra choice', () => {
    const request = input({ availability: { claude: true, openai: true, openaiLuna: true, openaiFull: false, openaiVision: false, gemini: false, mistral: false } })
    expect(resolveChatModelPreference(request, resolveRoute(request))).toBe('gpt-5.6-luna')
    setChatModelPreference('openai', 'gpt-5.6-terra')
    expect(() => resolveChatModelPreference(request, resolveRoute(request))).toThrow('trial_model_restricted')
  })
  it('uses Mini when only provider access is proven and rejects unproven saved full models', () => {
    const request = input({ availability: { claude: true, openai: true, openaiLuna: false, openaiFull: false, openaiVision: false, gemini: false, mistral: false } })
    expect(resolveChatModelPreference(request, resolveRoute(request))).toBe('gpt-5-mini')
    for (const model of ['gpt-5.6-luna', 'gpt-5.6-terra']) {
      setChatModelPreference('openai', model)
      expect(() => resolveChatModelPreference(request, resolveRoute(request))).toThrow('trial_model_restricted')
    }
  })
  it.each([['openai', 'gpt-5.6-luna'], ['openai', 'gpt-5.6-terra'], ['gemini', 'gemini-3.8-flash']] as const)('keeps %s / %s on private follow-ups', (provider, model) => {
    setChatModelPreference(provider, model)
    const request = input({ selectedModel: provider, originalText: 'Résume ça', hasPrivateHistory: true })
    expect(resolveChatModelPreference(request, resolveRoute(request))).toBe(model)
  })
  it('does not override Auto, Europe, documents or vision', () => {
    setChatModelPreference('openai', 'gpt-5.6-luna')
    for (const override of [{ selectedModel: 'auto' }, { euOnly: true }, { hasOfficeHistory: true }, { hasProjectContext: true }, { hasFiles: true }]) {
      const request = input(override as Partial<RouteInput>)
      expect(resolveChatModelPreference(request, resolveRoute(request))).toBeUndefined()
    }
    const request = input()
    expect(resolveChatModelPreference(request, { ...resolveRoute(request), usesOpenAIVision: true })).toBeUndefined()
  })
  it('rejects foreign or unregistered model identifiers', () => {
    setChatModelPreference('openai', 'claude-sonnet-5')
    expect(resolveChatModelPreference(input(), resolveRoute(input()))).toBeUndefined()
  })
})
