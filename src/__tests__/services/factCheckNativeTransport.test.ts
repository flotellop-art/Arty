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

import {
  factCheckResponse,
  prepareAssistantContent,
  recoverAssistantLinks,
} from '../../services/factChecker'

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

  it('récupère les liens via le transport Android natif et remplace l’URL morte', async () => {
    nativeRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        provider: 'linkup',
        query: 'lancement James-Webb NASA',
        bySource: {
          'nasa.gov': {
            results: [{
              title: 'NASA launches James Webb Space Telescope',
              url: 'https://www.nasa.gov/news-release/nasa-launches-james-webb-space-telescope/',
              snippet: 'NASA confirms the launch of Webb aboard Ariane 5.',
              verified: true,
            }],
          },
        },
      },
    })

    const question = 'Donne un lien officiel de la NASA sur le lancement de James-Webb.'
    const content = '[NASA, lancement de Webb](https://www.nasa.gov/page-inventee)'
    const initial = prepareAssistantContent(question, content, 'native-links')
    const recovered = await recoverAssistantLinks(question, content, initial)

    expect(recovered.content).toContain(
      '(https://www.nasa.gov/news-release/nasa-launches-james-webb-space-telescope/)',
    )
    expect(recovered.removedLinks).toBe(0)
    expect(recovered.replacedLinks).toBe(1)
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://tryarty.com/api/search/web',
      method: 'POST',
      headers: expect.objectContaining({
        Origin: 'https://localhost',
        'x-google-token': 'google-token',
      }),
      data: expect.objectContaining({
        maxResults: 1,
        sources: ['nasa.gov'],
        verifyUrls: true,
      }),
      connectTimeout: 10_000,
      readTimeout: 30_000,
      responseType: 'json',
    }))
  })

  it('transmet le redirect Google au serveur et utilise sa destination verifiee', async () => {
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/arianespace'
    nativeRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        provider: 'linkup',
        query: 'vol VA256 Arianespace',
        results: [{
          title: 'newsroom.arianespace.com',
          url: 'https://newsroom.arianespace.com/ariane-flight-va256/',
          snippet: 'Arianespace flight VA256.',
          verified: true,
        }],
      },
    })

    const question = 'Donne le lien officiel Arianespace du vol VA256.'
    const content = `[Arianespace, vol VA256](${redirect})`
    const initial = prepareAssistantContent(question, content, 'native-redirect')
    const recovered = await recoverAssistantLinks(question, content, initial)

    expect(recovered.content).toContain(
      '[Arianespace, vol VA256](https://newsroom.arianespace.com/ariane-flight-va256/)',
    )
    expect(recovered.content).not.toContain('grounding-api-redirect')
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        redirectUrls: [redirect],
        verifyUrls: true,
      }),
    }))
  })

  it('refuse un résultat NASA rangé à tort dans le domaine ESA', async () => {
    nativeRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: {
        provider: 'linkup',
        query: 'lancement James-Webb ESA',
        bySource: {
          'esa.int': {
            results: [{
              title: 'NASA image of the Webb launch',
              url: 'https://www.nasa.gov/image-article/james-webb-launch/',
              snippet: 'Cette page mentionne aussi ESA et Arianespace.',
              verified: true,
            }],
          },
        },
      },
    })

    const question = 'Donne un lien officiel de l’ESA sur le lancement de James-Webb.'
    const content = '[ESA, lancement de Webb](https://www.esa.int/page-inventee)'
    const initial = prepareAssistantContent(question, content, 'native-wrong-domain')
    const recovered = await recoverAssistantLinks(question, content, initial)

    // URL directe neutralisée : préservée en code inline NON cliquable
    // (plus jamais détruite), jamais remplacée par un domaine étranger.
    expect(recovered.content).toContain('`https://www.esa.int/page-inventee`')
    expect(recovered.content).toContain('*(non vérifié)*')
    expect(recovered.content).not.toContain('](https://www.esa.int/page-inventee)')
    expect(recovered.content).not.toContain('(https://www.nasa.gov/')
    expect(recovered.replacedLinks).toBe(0)
  })

  it('bascule sur fetch WebView quand le DNS natif échoue avant émission', async () => {
    nativeRequest.mockRejectedValue({
      code: 'UnknownHostException',
      message: 'Unable to resolve host "tryarty.com": No address associated with hostname',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({
        content: [{
          type: 'text',
          text: '{"overall_confidence":"high","claims":[]}',
        }],
        usage: {},
      }), { status: 200 }),
    )

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome.result?.status).toBe('success-empty')
    expect(nativeRequest).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    // Le token part sur les deux transports ; Origin est un forbidden header
    // pour fetch (la WebView pose le sien) — le repli ne doit pas le passer.
    expect(headers['x-google-token']).toBe('google-token')
    expect(headers.Origin).toBeUndefined()

    fetchSpy.mockRestore()
  })

  it('ne bascule JAMAIS sur un timeout natif ambigu (double-quota interdit)', async () => {
    nativeRequest.mockRejectedValue({
      code: 'SocketTimeoutException',
      message: 'failed to connect to tryarty.com (port 443) after 15000ms',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome).toEqual({ result: null, reason: 'réseau — délai dépassé' })
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('ne rejoue jamais après une réponse HTTP reçue', async () => {
    nativeRequest.mockResolvedValue({
      status: 500,
      headers: { 'content-type': 'application/json' },
      data: { error: 'boom' },
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome.result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('sans code natif (iOS), aucun repli', async () => {
    nativeRequest.mockRejectedValue(new Error('The request timed out.'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome.result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('masque le message natif brut (IP locale) derrière une catégorie', async () => {
    nativeRequest.mockRejectedValue({
      code: 'ConnectException',
      message: 'Failed to connect to tryarty.com/104.21.4.4:443 from /192.168.1.34 (port 40412)',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })

    const outcome = await factCheckResponse(
      'Quelle information faut-il vérifier ?',
      'Cette réponse dépasse volontairement quatre-vingts caractères afin de déclencher la vérification factuelle.',
      'haiku',
      null,
    )

    expect(outcome.result).toBeNull()
    expect('reason' in outcome && outcome.reason).toBe('réseau indisponible')
    expect(JSON.stringify(outcome)).not.toContain('192.168')
    // ConnectException est pré-émission : le repli a bien été tenté.
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it('récupère les liens via le repli WebView quand le DNS natif échoue', async () => {
    nativeRequest.mockRejectedValue({
      code: 'UnknownHostException',
      message: 'Unable to resolve host "tryarty.com": No address associated with hostname',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({
        provider: 'linkup',
        query: 'lancement James-Webb NASA',
        bySource: {
          'nasa.gov': {
            results: [{
              title: 'NASA launches James Webb Space Telescope',
              url: 'https://www.nasa.gov/news-release/nasa-launches-james-webb-space-telescope/',
              snippet: 'NASA confirms the launch of Webb aboard Ariane 5.',
              verified: true,
            }],
          },
        },
      }), { status: 200 }),
    )

    const question = 'Donne un lien officiel de la NASA sur le lancement de James-Webb.'
    const content = '[NASA, lancement de Webb](https://www.nasa.gov/page-inventee)'
    const initial = prepareAssistantContent(question, content, 'native-links-fallback')
    const recovered = await recoverAssistantLinks(question, content, initial)

    expect(recovered.content).toContain(
      '(https://www.nasa.gov/news-release/nasa-launches-james-webb-space-telescope/)',
    )
    expect(recovered.removedLinks).toBe(0)
    expect(recovered.replacedLinks).toBe(1)
    expect(fetchSpy).toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
