import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractAnswerResults,
  resolveGoogleGroundingRedirects,
  verifySearchResults,
} from '../../../functions/api/search/web'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolution des redirects Google', () => {
  it('resout le redirect sans visiter sa destination', async () => {
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/signed'
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: {
        location: 'https://newsroom.arianespace.com/ariane-flight-va256/',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await resolveGoogleGroundingRedirects([redirect])

    expect(resolved).toEqual([{
      title: 'newsroom.arianespace.com',
      url: 'https://newsroom.arianespace.com/ariane-flight-va256/',
      snippet: '',
    }])
    expect(fetchMock).toHaveBeenCalledWith(
      redirect,
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
      }),
    )
  })

  it('refuse la destination privee du redirect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    })))

    const resolved = await resolveGoogleGroundingRedirects([
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/signed',
    ])

    expect(resolved).toEqual([])
  })
})

describe('vérification réelle des liens de recherche', () => {
  it('récupère les URL directes diversifiées présentes dans la réponse sourcée', () => {
    const results = extractAnswerResults([
      'NASA : https://www.nasa.gov/solar-system/webb-launch/',
      'ESA : https://www.esa.int/Science_Exploration/Webb_launch',
      'Arianespace : https://www.arianespace.com/mission/ariane-flight-va256/',
    ].join('\n'))

    expect(results).toEqual([
      expect.objectContaining({
        title: 'NASA',
        url: 'https://www.nasa.gov/solar-system/webb-launch/',
      }),
      expect.objectContaining({
        title: 'ESA',
        url: 'https://www.esa.int/Science_Exploration/Webb_launch',
      }),
      expect.objectContaining({
        title: 'Arianespace',
        url: 'https://www.arianespace.com/mission/ariane-flight-va256/',
      }),
    ])
  })

  it('conserve seulement les pages publiques que Linkup parvient à relire', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || '{}')) as { url?: string }
      if (payload.url?.includes('/vivante')) return new Response('{}', { status: 200 })
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const verified = await verifySearchResults('linkup-key', [
      {
        title: 'Page vivante',
        url: 'https://source.example/vivante',
        snippet: 'Une source accessible.',
      },
      {
        title: 'Page morte',
        url: 'https://source.example/morte',
        snippet: 'Une ancienne source.',
      },
      {
        title: 'Adresse interne',
        url: 'http://127.0.0.1/admin',
        snippet: 'Ne doit jamais être appelée.',
      },
    ])

    expect(verified).toEqual([{
      title: 'Page vivante',
      url: 'https://source.example/vivante',
      snippet: 'Une source accessible.',
      verified: true,
    }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linkup.so/v1/fetch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer linkup-key',
        }),
      }),
    )
  })

  it('active le rendu JavaScript seulement pour un lien court reconnu', async () => {
    const payloads: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>)
      return new Response('{}', { status: 200 })
    }))

    await verifySearchResults('linkup-key', [{
      title: 'Lien partagé',
      url: 'https://share.google/example',
      snippet: '',
    }])

    expect(payloads).toEqual([expect.objectContaining({
      url: 'https://share.google/example',
      renderJs: true,
    })])
  })
})
