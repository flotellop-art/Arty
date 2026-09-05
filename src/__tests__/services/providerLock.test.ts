import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isProviderLockedForPlan } from '../../services/providerLock'

vi.mock('../../services/activeApiKey', () => ({
  getOpenAIKey: vi.fn(() => null),
  getAnthropicKey: vi.fn(() => null),
  getGeminiKey: vi.fn(() => null),
  getMistralKey: vi.fn(() => null),
}))

import { getAnthropicKey, getGeminiKey, getMistralKey, getOpenAIKey } from '../../services/activeApiKey'

const mockOpenAIKey = vi.mocked(getOpenAIKey)

beforeEach(() => {
  mockOpenAIKey.mockReturnValue(null)
  vi.mocked(getAnthropicKey).mockReturnValue(null)
  vi.mocked(getGeminiKey).mockReturnValue(null)
  vi.mocked(getMistralKey).mockReturnValue(null)
})

describe('isProviderLockedForPlan', () => {
  it.each([
    ['claude', 'claude-haiku', getAnthropicKey], ['gemini', 'gemini-flash', getGeminiKey],
    ['mistral', 'mistral-medium', getMistralKey], ['openai', 'gpt-mini', getOpenAIKey],
  ] as const)('%s accepts a real key, never the sentinel or whitespace', (provider, family, getter) => {
    for (const key of ['server-provided', ' ', null]) {
      vi.mocked(getter).mockReturnValue(key)
      expect(isProviderLockedForPlan(provider, [family])).toBe(true)
    }
    vi.mocked(getter).mockReturnValue('personal-key')
    expect(isProviderLockedForPlan(provider, [family])).toBe(false)
  })
  it('garde les providers serveur verrouillés par le plan', () => {
    expect(isProviderLockedForPlan('openai', ['gpt-mini'])).toBe(true)
    expect(isProviderLockedForPlan('mistral', ['mistral-medium'])).toBe(true)
    expect(isProviderLockedForPlan('auto', ['gpt-mini'])).toBe(false)
  })

  it('déverrouille OpenAI avec une clé personnelle, y compris en essai', () => {
    mockOpenAIKey.mockReturnValue('sk-user')
    expect(isProviderLockedForPlan('openai', ['gpt-mini', 'gpt-full'])).toBe(false)
  })
})
