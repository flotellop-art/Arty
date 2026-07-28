import { beforeEach, describe, expect, it, vi } from 'vitest'

const { nativeRequest } = vi.hoisted(() => ({
  nativeRequest: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
  CapacitorHttp: {
    request: nativeRequest,
  },
}))

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => 'google-token'),
}))

vi.mock('../../services/costTracker', () => ({
  recordUsage: vi.fn(),
}))

import { factCheckResponse } from '../../services/factChecker'

describe('fact-check, transport Android natif', () => {
  beforeEach(() => {
    nativeRequest.mockReset()
    nativeRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            overall_confidence: 'high',
            claims: [],
          }),
        }],
        usage: {},
      },
    })
  })

  it('évite fetch WebView et conserve l’Origin exigé par Cloudflare', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome.result?.status).toBe('success-empty')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://tryarty.com/api/ai/fact-check',
      method: 'POST',
      headers: expect.objectContaining({
        Origin: 'https://localhost',
        'x-google-token': 'google-token',
      }),
      connectTimeout: 15_000,
      readTimeout: 90_000,
      responseType: 'json',
    }))

    fetchSpy.mockRestore()
  })

  it('recompose un JSON coupé par les citations et affiche le modèle de secours', async () => {
    nativeRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        model: 'claude-sonnet-5',
        fallback: 'model',
        content: [
          { type: 'text', text: 'Je vérifie. ' },
          { type: 'server_tool_use' },
          { type: 'text', text: '{"overall_confidence":"high",' },
          { type: 'text', text: '"claims":[]}' },
        ],
        usage: {},
      },
    })

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome.result?.status).toBe('success-empty')
    expect(outcome.result?.modelLabel).toBe('Sonnet 5 (secours)')
  })

  it('affiche le fournisseur de secours réellement servi', async () => {
    nativeRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        model: 'gemini-3.6-flash',
        fallback: 'provider',
        content: [{
          type: 'text',
          text: '{"overall_confidence":"high","claims":[]}',
        }],
        usage: {},
      },
    })

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome.result?.status).toBe('success-empty')
    expect(outcome.result?.modelLabel).toBe('Gemini 3.6 Flash (secours)')
  })

  it('masque le 503 upstream derrière une raison lisible', async () => {
    nativeRequest.mockResolvedValue({
      status: 503,
      headers: { 'content-type': 'application/json' },
      data: { error: 'fact_check_failed', retryable: true },
    })

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome).toEqual({
      result: null,
      reason: 'service de vérification temporairement indisponible',
    })
  })
})
