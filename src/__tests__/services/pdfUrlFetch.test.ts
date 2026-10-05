// Tests de fetchUrlMarkdowns (fix paywall/natif du 11 juin 2026). Vérifie
// que : (1) l'URL appelée passe par apiUrl, (2) un 502 « Empty document »
// (paywall) remonte dans `unreadable` sans casser, (3) un succès produit le
// bloc inliné.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: () => Promise.resolve('tok'),
}))
// apiUrl renvoie le chemin tel quel en web (API_BASE = '') — on l'utilise
// pour vérifier que fetchOne passe bien par lui (pas un fetch nu).
vi.mock('../../services/apiBase', () => ({
  apiUrl: (p: string) => `https://api.test${p}`,
}))

import { fetchUrlMarkdowns } from '../../services/pdfUrlFetch'

describe('fetchUrlMarkdowns', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('appelle /api/fetch/url via apiUrl (host absolu)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ markdown: 'Contenu article' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { block } = await fetchUrlMarkdowns(['https://ex.fr/a'])
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/fetch/url', expect.anything())
    expect(block).toContain('Contenu article')
    expect(block).toContain('https://ex.fr/a')
  })

  it('502 (paywall/empty) → bloc null + URL dans unreadable, pas de crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))
    const { block, unreadable } = await fetchUrlMarkdowns(['https://lefigaro.fr/x'])
    expect(block).toBeNull()
    expect(unreadable).toEqual(['https://lefigaro.fr/x'])
  })

  it('panne réseau → error (pas unreadable), bloc null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { block, unreadable } = await fetchUrlMarkdowns(['https://ex.fr/a'])
    expect(block).toBeNull()
    expect(unreadable).toEqual([]) // panne technique ≠ paywall
  })

  it('mix : une page lue, une paywall', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ markdown: 'ok' }) })
      .mockResolvedValueOnce({ ok: false, status: 502 })
    vi.stubGlobal('fetch', fetchMock)
    const { block, unreadable } = await fetchUrlMarkdowns(['https://a.fr/1', 'https://b.fr/2'])
    expect(block).toContain('ok')
    expect(unreadable).toEqual(['https://b.fr/2'])
  })
  it('keeps a service 503 and the fourth unprocessed URL explicit in a mixed batch', async () => {
    const spy = vi.fn().mockResolvedValueOnce(Response.json({ markdown: 'first page' }))
      .mockResolvedValueOnce(Response.json({ error: 'index_unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ markdown: 'third page' }))
    vi.stubGlobal('fetch', spy)
    const result = await fetchUrlMarkdowns(['https://a.test/', 'https://b.test/', 'https://c.test/', 'https://d.test/'])
    expect(result.block).toContain('first page')
    expect(result.unavailable).toEqual(['https://b.test/', 'https://d.test/'])
    expect(result.unreadable).toEqual([])
    expect(spy).toHaveBeenCalledTimes(3)
  })
  it('passes EU-only policy and reports actual browser provenance and omissions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ markdown: 'Read post',
      receipt: { provider: 'arty-browser', access: 'anonymous', commentsIncluded: false, truncated: true } }) })
    vi.stubGlobal('fetch', fetchMock)
    const { block } = await fetchUrlMarkdowns(['https://example.com/'], undefined, 'eu-only')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/', readerPolicy: 'eu-only' })
    expect(block).toContain('navigateur Arty'); expect(block).toContain('commentaires non lus'); expect(block).toContain('contenu tronqué')
    expect(block).not.toContain('(EU)')
  })
  it('keeps a browser refusal associated with its requested URL in a mixed batch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ markdown: 'Read page' }))
      .mockResolvedValueOnce(Response.json({ provider: 'arty-browser', reason: 'site_security', upstreamHttpStatus: 403,
        stage: 'navigation', error: 'private raw error' }, { status: 502 })))
    const result = await fetchUrlMarkdowns(['https://example.com/', 'https://www.reddit.com/r/x/comments/id/'])
    expect(result.block).toContain('Read page')
    expect(result.failures).toEqual([{ url: 'https://www.reddit.com/r/x/comments/id/', reason: 'site_security', upstreamHttpStatus: 403, stage: 'navigation' }])
    expect(JSON.stringify(result)).not.toContain('private raw error')
  })
  it('does not turn an unknown or non-browser error into a site diagnosis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ reason: 'site_security', error: 'RAW' }, { status: 502 })))
    expect((await fetchUrlMarkdowns(['https://example.com/'])).failures).toBeUndefined()
  })
})
