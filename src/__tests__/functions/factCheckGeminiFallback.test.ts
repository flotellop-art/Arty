import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkAllowedUserPeekMock, consumeCapAtomicMock, recordUsageMock } = vi.hoisted(() => ({
  checkAllowedUserPeekMock: vi.fn(),
  consumeCapAtomicMock: vi.fn(),
  recordUsageMock: vi.fn(),
}))

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({
  checkAllowedUserPeek: checkAllowedUserPeekMock,
}))

vi.mock('../../../functions/api/_lib/atomicQuota', () => ({
  consumeCapAtomic: consumeCapAtomicMock,
}))

vi.mock('../../../functions/api/_lib/quota', () => ({
  recordUsage: recordUsageMock,
}))

import {
  onRequestPost,
  requestGeminiFactCheck,
} from '../../../functions/api/ai/fact-check'

describe('endpoint fact-check, secours fournisseur Gemini', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    checkAllowedUserPeekMock.mockReset()
    checkAllowedUserPeekMock.mockResolvedValue({
      email: 'owner@example.test',
      planType: 'vip',
    })
    consumeCapAtomicMock.mockReset()
    consumeCapAtomicMock.mockResolvedValue({ status: 'consumed' })
    recordUsageMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sert réellement Gemini quand Anthropic refuse la requête', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: '{"overall_confidence":"high","claims":[]}',
            }],
          },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
        },
      }), { status: 200 }))

    const response = await onRequestPost({
      request: new Request('https://tryarty.com/api/ai/fact-check', {
        method: 'POST',
        body: JSON.stringify({
          tier: 'haiku',
          question: 'Quels sont les faits du jour ?',
          response: 'Cette réponse contient suffisamment de texte pour déclencher une vérification factuelle complète côté serveur.',
          sources: '',
        }),
      }),
      env: {
        ANTHROPIC_API_KEY: 'anthropic-test-key',
        GEMINI_API_KEY: 'gemini-test-key',
      },
    } as never)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      model: 'gemini-3.6-flash',
      fallback: 'provider',
    }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/messages')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/gemini-3.6-flash:generateContent')
    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.anything(),
      'owner@example.test',
      'gemini-3.6-flash',
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 20,
      }),
    )
  })

  it('normalise la réponse Gemini 3.6 et active Google Search pour la passe approfondie', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              overall_confidence: 'high',
              claims: [],
            }),
          }],
        },
        groundingMetadata: {
          webSearchQueries: ['résultats Porsche 2026'],
          groundingChunks: [{ web: { uri: 'https://example.test' } }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 30,
        thoughtsTokenCount: 5,
        cachedContentTokenCount: 20,
      },
    }), { status: 200 }))

    const result = await requestGeminiFactCheck(
      'test-key',
      'Question et réponse à vérifier',
      4_000,
      true,
      10_000,
    )

    expect(result.status).toBe(200)
    expect(result.payload).toEqual(expect.objectContaining({
      model: 'gemini-3.6-flash',
      content: [expect.objectContaining({ type: 'text' })],
      usage: expect.objectContaining({
        input_tokens: 100,
        output_tokens: 35,
        cache_read_input_tokens: 20,
        grounded_prompts: 1,
        search_grounded_prompts: 1,
        search_queries: 1,
      }),
    }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/gemini-3.6-flash:generateContent')
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.tools).toEqual([{ google_search: {} }])
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.required).toEqual([
      'overall_confidence',
      'claims',
    ])
  })

  it('essaie Gemini 3.5 si Gemini 3.6 est indisponible', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: '{"overall_confidence":"medium","claims":[]}',
            }],
          },
        }],
        usageMetadata: {},
      }), { status: 200 }))

    const result = await requestGeminiFactCheck(
      'test-key',
      'Question et réponse à vérifier',
      3_000,
      false,
      10_000,
    )

    expect(result.payload?.model).toBe('gemini-3.5-flash')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/gemini-3.5-flash:generateContent')
  })

  it('ne répète pas une erreur de clé sur un autre modèle Gemini', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))

    const result = await requestGeminiFactCheck(
      'test-key',
      'Question et réponse à vérifier',
      3_000,
      false,
      10_000,
    )

    expect(result).toEqual({ payload: null, status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
