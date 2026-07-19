// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// Désambiguïsation des 404 (fix post-terrain 19 juil.) : le 404 uniforme
// d'auth (notFoundResponse → {error:'Not found'}) ne doit PAS être présenté
// comme « lieu introuvable » — seul le 404 métier du endpoint l'est.

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => 'tok'),
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => `https://test.local${p}` }))

import { searchTrails, fetchTrailGeometry } from '../../services/trailsClient'

afterEach(() => vi.unstubAllGlobals())

function stubFetchResponse(body: unknown, status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

describe('trailsClient — classification des réponses', () => {
  it('404 métier « Lieu introuvable » → not_found', async () => {
    stubFetchResponse({ error: 'Lieu introuvable' }, 404)
    expect(await searchTrails({ location: 'Nulle-Part' })).toEqual({ ok: false, status: 'not_found' })
  })

  it('404 métier « Circuit introuvable » → not_found', async () => {
    stubFetchResponse({ error: 'Circuit introuvable' }, 404)
    expect(await fetchTrailGeometry(999)).toEqual({ ok: false, status: 'not_found' })
  })

  it("404 uniforme d'auth (Not found) → error, jamais « lieu introuvable »", async () => {
    stubFetchResponse({ error: 'Not found' }, 404)
    expect(await searchTrails({ location: 'Viriville' })).toEqual({ ok: false, status: 'error' })
  })

  it('429 → quota ; 502 → error ; fetch qui échoue → network', async () => {
    stubFetchResponse({ error: 'daily_limit_reached' }, 429)
    expect(await searchTrails({ location: 'Viriville' })).toEqual({ ok: false, status: 'quota' })

    stubFetchResponse({ error: 'Service indisponible' }, 502)
    expect(await searchTrails({ location: 'Viriville' })).toEqual({ ok: false, status: 'error' })

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
    expect(await searchTrails({ location: 'Viriville' })).toEqual({ ok: false, status: 'network' })
  })

  it('200 → ok avec le payload', async () => {
    stubFetchResponse({ center: { lat: 1, lon: 2, label: 'X' }, radiusKm: 10, kind: 'all', routes: [], totalFound: 0, nearbyPathCount: 0 }, 200)
    const out = await searchTrails({ location: 'X' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.data.center.label).toBe('X')
  })
})
