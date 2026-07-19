import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isProviderLockedForPlan } from '../../services/providerLock'

vi.mock('../../services/activeApiKey', () => ({
  getOpenAIKey: vi.fn(() => null),
}))

import { getOpenAIKey } from '../../services/activeApiKey'

const mockOpenAIKey = vi.mocked(getOpenAIKey)

beforeEach(() => {
  mockOpenAIKey.mockReturnValue(null)
})

describe('isProviderLockedForPlan', () => {
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
