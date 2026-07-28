import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifySearchResults } from '../../../functions/api/search/web'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('vérification réelle des liens de recherche', () => {
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
