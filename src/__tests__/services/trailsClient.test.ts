// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  fetchTrailGeometriesDirect: vi.fn(async () => null),
}))

import { searchTrails, fetchTrailGeometries, fetchTrailGeometry, isTrailGeometry } from '../../services/trailsClient'
import { searchTrailsDirect, fetchTrailGeometriesDirect, fetchTrailGeometryDirect } from '../../services/trailsOsm'

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function stubFetchResponse(body: unknown, status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

describe('trailsClient — classification des réponses', () => {
  it('rejette un payload geometry-v3 incomplet', () => {
    expect(isTrailGeometry({
      id: 42, name: 'X', kind: 'horse', distanceKm: 3,
      sourceSegments: [[[45.3, 5.2], [45.31, 5.2]]],
      displaySegments: [[[45.3, 5.2], [45.31, 5.2]]],
    })).toBe(false)
  })
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
    const sourceSegments = [[[45.3, 5.2], [45.31, 5.2]]]
    stubFetchResponse({
      id: 42, name: 'X', kind: 'horse', distanceKm: 3, distanceMeters: 3000,
      sourceSegments, sourceSegmentDirectionLocked: [false], displaySegments: sourceSegments,
      integrity: { hasNestedRelations: false, unsupportedWayRoles: [], displaySafe: true },
      provenance: { provider: 'OpenStreetMap', relationId: 42, fetchedAt: Date.now() },
    }, 200)
    vi.mocked(fetchTrailGeometryDirect).mockResolvedValueOnce(null)
    const out = await fetchTrailGeometry(42)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.data.name).toBe('X')
  })

  it('le timeout du repli couvre aussi un corps HTTP bloqué', async () => {
    vi.useFakeTimers()
    vi.mocked(fetchTrailGeometryDirect).mockResolvedValueOnce(null)
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":42'))
          signal?.addEventListener('abort', () => controller.error(new DOMException('Timeout', 'AbortError')))
        },
      }), { status: 200 })
    }))
    const pending = fetchTrailGeometry(42)
    await vi.advanceTimersByTimeAsync(45_001)
    await expect(pending).resolves.toEqual({ ok: false, status: 'network' })
  })

  it('vérifie plusieurs géométries en un seul appel direct', async () => {
    vi.mocked(fetchTrailGeometriesDirect).mockResolvedValueOnce({
      ok: true,
      data: [{ id: 42, name: 'X', kind: 'horse', distanceKm: 3, sourceSegments: [], displaySegments: [] }],
    })
    const out = await fetchTrailGeometries([42])
    expect(out.ok).toBe(true)
    expect(fetchTrailGeometriesDirect).toHaveBeenCalledWith([42], expect.any(Number))
  })

  it('conserve un lot déjà vérifié si un lot suivant est indisponible', async () => {
    vi.mocked(fetchTrailGeometriesDirect).mockClear()
    const verified = { id: 1, name: 'A', kind: 'horse', distanceKm: 3, sourceSegments: [], displaySegments: [] }
    vi.mocked(fetchTrailGeometriesDirect)
      .mockResolvedValueOnce({ ok: true, data: [verified] })
      .mockResolvedValueOnce(null)
    stubFetchResponse({ error: 'Service indisponible' }, 502)
    const out = await fetchTrailGeometries([1, 2, 3, 4])
    expect(out).toEqual({ ok: true, data: [verified] })
    expect(fetchTrailGeometriesDirect).toHaveBeenNthCalledWith(1, [1, 2, 3], expect.any(Number))
    expect(fetchTrailGeometriesDirect).toHaveBeenNthCalledWith(2, [4], expect.any(Number))
  })

  it('subdivise un lot en échec pour sauver les relations individuelles', async () => {
    vi.mocked(fetchTrailGeometriesDirect).mockResolvedValueOnce(null)
    vi.mocked(fetchTrailGeometryDirect)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 1, name: 'A', kind: 'horse', distanceKm: 3,
          sourceSegments: [[[45.3, 5.2], [45.31, 5.2]]],
          sourceSegmentDirectionLocked: [false],
          displaySegments: [[[45.3, 5.2], [45.31, 5.2]]],
        },
      })
      .mockResolvedValueOnce({ ok: false, status: 'not_found' })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 3, name: 'C', kind: 'horse', distanceKm: 4,
          sourceSegments: [[[45.4, 5.2], [45.41, 5.2]]],
          sourceSegmentDirectionLocked: [false],
          displaySegments: [[[45.4, 5.2], [45.41, 5.2]]],
        },
      })
    stubFetchResponse({ error: 'Service indisponible' }, 502)

    const out = await fetchTrailGeometries([1, 2, 3])
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.data.map((trail) => trail.id)).toEqual([1, 3])
    expect(fetchTrailGeometryDirect).toHaveBeenCalledTimes(3)
  })
})
