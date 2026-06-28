import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => null),
}))

vi.mock('../../services/activeApiKey', () => ({
  getMistralKey: vi.fn(() => null),
}))

vi.mock('../../services/costTracker', () => ({
  recordUsage: vi.fn(),
}))

import { factCheckResponse } from '../../services/factChecker'
import { isEuLockedConversation, markMistralUsed } from '../../services/dataResidency'
import type { Conversation } from '../../types'

describe('data residency routing', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('locks a conversation to EU once Mistral has been used', () => {
    expect(isEuLockedConversation({ usedModels: ['claude'] })).toBe(false)
    expect(isEuLockedConversation({ euOnly: true, usedModels: ['claude'] })).toBe(true)
    expect(isEuLockedConversation({ usedModels: ['claude', 'mistral'] })).toBe(true)
  })

  it('marks Mistral usage as sticky euOnly metadata', () => {
    const conv: Conversation = {
      id: 'c1',
      title: 'test',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      usedModels: ['claude'],
    }

    markMistralUsed(conv)
    markMistralUsed(conv)

    expect(conv.euOnly).toBe(true)
    expect(conv.usedModels).toEqual(['claude', 'mistral'])
  })

  it('routes EU-locked fact-checks to the Mistral proxy, not Claude', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      choices: [{ message: { content: '{"overall_confidence":"high","claims":[]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await factCheckResponse(
      'Question utilisateur avec assez de texte '.repeat(5),
      'Réponse assistant avec assez de texte pour déclencher la vérification. '.repeat(5),
      'auto',
      null,
      { euOnly: true }
    )

    expect(outcome.result?.modelLabel).toBe('Mistral Medium 3.5 (EU)')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/ai/mistral-proxy')
    expect(String(url)).not.toContain('/api/ai/proxy')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('mistral-medium-latest')
    expect(body.tools).toBeUndefined()
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
  })

  it('keeps non-EU auto fact-checks on Claude Sonnet with web_search', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      content: [{ type: 'text', text: '{"overall_confidence":"high","claims":[]}' }],
      usage: { input_tokens: 12, output_tokens: 4 },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const outcome = await factCheckResponse(
      'Question utilisateur avec assez de texte '.repeat(5),
      'Réponse assistant avec assez de texte pour déclencher la vérification. '.repeat(5),
      'auto'
    )

    expect(outcome.result?.modelLabel).toBe('Sonnet 4.6')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/ai/proxy')
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }])
  })
})
