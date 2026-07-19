// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// Désambiguïsation des 404 (fix post-terrain 19 juil.) : le 404 uniforme
// d'auth (notFoundResponse → {error:'Not found'}) ne doit PAS être présenté
// comme « lieu introuvable » — seul le 404 métier du endpoint l'est.

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => 'tok'),
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => `https://test.local${p}` }))
// Le pipeline direct est neutralisé par défaut (null = « infra injoignable »)
// pour tester la classification du REPLI serveur ; les tests de façade le
// surchargent explicitement.
vi.mock('../../services/trailsOsm', () => ({
  searchTrailsDirect: vi.fn(async () => null),
  fetchTrailGeometryDirect: vi.fn(async () => null),
}))

import { searchTrails, fetchTrailGeometry } from '../../services/trailsClient'
import { searchTrailsDirect, fetchTrailGeometryDirect } from '../../services/trailsOsm'

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

describe('trailsClient — façade direct-d\'abord (fix egress Cloudflare filtré)', () => {
  it('le pipeline direct qui répond court-circuite le serveur (zéro fetch API)', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    vi.mocked(searchTrailsDirect).mockResolvedValueOnce({
      ok: true,
      data: { center: { lat: 45.3, lon: 5.2, label: 'Viriville' }, radiusKm: 10, kind: 'all', routes: [], totalFound: 0, nearbyPathCount: 12 },
    })
    const out = await searchTrails({ location: 'Viriville' })
    expect(out.ok).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('un « introuvable » DÉFINITIF du direct ne déclenche pas le repli serveur', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    vi.mocked(fetchTrailGeometryDirect).mockResolvedValueOnce({ ok: false, status: 'not_found' })
    const out = await fetchTrailGeometry(42)
    expect(out).toEqual({ ok: false, status: 'not_found' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('direct injoignable (null) → repli serveur', async () => {
    stubFetchResponse({ id: 42, name: 'X', kind: 'horse', distanceKm: 3, segments: [[[45.3, 5.2], [45.31, 5.2]]] }, 200)
    vi.mocked(fetchTrailGeometryDirect).mockResolvedValueOnce(null)
    const out = await fetchTrailGeometry(42)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.data.name).toBe('X')
  })
})
