// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest'
import { parseSearchElements, searchTrailsDirect, fetchTrailGeometriesDirect, fetchTrailGeometryDirect } from '../../services/trailsOsm'
import { onRequestPost } from '../../../functions/api/geo/trails'

// PARITÉ client ↔ serveur : trailsOsm.ts (pipeline direct, IP utilisateur)
// miroite functions/api/geo/trails.ts (repli). Ce test nourrit la MÊME
// réponse Overpass aux deux implémentations et exige les mêmes routes —
// si l'une évolue sans l'autre, CI rouge.

const GEOM = [
  { lat: 45.3, lon: 5.2 },
  { lat: 45.3009, lon: 5.2 },
  { lat: 45.3018, lon: 5.2 },
]

const OVERPASS_BODY = {
  elements: [
    { type: 'relation', id: 111, tags: { type: 'route', route: 'hiking', network: 'lwn', colour: 'yellow' }, members: [{ type: 'way', geometry: GEOM }] },
    { type: 'relation', id: 222, tags: { type: 'route', route: 'horse', name: 'Boucle des Bouviers' }, members: [{ type: 'way', geometry: GEOM }] },
    { type: 'relation', id: 333, tags: { type: 'route', route: 'hiking', network: 'rwn', name: 'GR de pays' }, members: [{ type: 'way', geometry: GEOM }] },
    { type: 'count', id: 0, tags: { total: '99', ways: '99' } },
  ],
}

const EMAIL = 'flo@example.com'
const env = { GOOGLE_CLIENT_ID: 'arty-client-id', ALLOWED_EMAILS: EMAIL } as unknown

afterEach(() => vi.unstubAllGlobals())

function stubServerFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes('/tokeninfo')) return new Response(JSON.stringify({ aud: 'arty-client-id' }), { status: 200 })
    if (u.includes('/oauth2/v2/userinfo')) {
      return new Response(JSON.stringify({ id: 'g-1', email: EMAIL, verified_email: true }), { status: 200 })
    }
    if (u.includes('overpass')) {
      return new Response(JSON.stringify(OVERPASS_BODY), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
}

describe('parité trailsOsm ↔ endpoint serveur', () => {
  it('la même réponse Overpass produit les mêmes routes (ids, tri, distances, labels)', async () => {
    // Côté serveur : via l'endpoint HTTP complet.
    stubServerFetch()
    const res = await onRequestPost({
      request: new Request('https://tryarty.com/api/geo/trails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-google-token': 'tok' },
        body: JSON.stringify({ action: 'search', location: '45.313,5.204', radiusKm: 8 }),
      }),
      env,
    } as never)
    expect(res.status).toBe(200)
    const server = await res.json() as { routes: unknown }

    // Côté client : parse direct des mêmes éléments.
    const client = parseSearchElements(OVERPASS_BODY.elements as never, {
      center: { lat: 45.313, lon: 5.204 }, radiusM: 8000,
    })

    expect(client.routes).toEqual(server.routes)
    expect(client.nearbyPathCount).toBe(99)
  })

  it('pipeline direct complet : coords → Overpass → résultat trié', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('overpass')) return new Response(JSON.stringify(OVERPASS_BODY), { status: 200 })
      throw new Error('unexpected fetch ' + u)
    }))
    const out = await searchTrailsDirect({ location: '45.313,5.204', radiusKm: 8 })
    expect(out).not.toBeNull()
    if (out && out.ok) {
      expect(out.data.routes.map((r) => r.id)).toEqual([222, 111, 333])
      expect(out.data.nearbyPathCount).toBe(99)
    } else {
      throw new Error('direct search should succeed')
    }
  })

  it('direct : toutes instances Overpass KO → null (la façade tentera le serveur)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 504 })))
    expect(await searchTrailsDirect({ location: '45.313,5.204' })).toBeNull()
  })

  it('direct : relation inconnue → not_found définitif (pas de repli inutile)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 })))
    expect(await fetchTrailGeometryDirect(999999)).toEqual({ ok: false, status: 'not_found' })
  })

  it('direct : vérifie un lot de relations dans une seule réponse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(OVERPASS_BODY), { status: 200 })))
    const out = await fetchTrailGeometriesDirect([111, 222])
    expect(out?.ok).toBe(true)
    if (out?.ok) expect(out.data.map((trail) => trail.id)).toEqual([111, 222])
  })

  it('direct : applique le rôle backward avant la construction GPX', async () => {
    const a = { lat: 45.3, lon: 5.2 }
    const b = { lat: 45.301, lon: 5.2 }
    const c = { lat: 45.302, lon: 5.2 }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      elements: [{
        type: 'relation', id: 77, tags: { route: 'horse' }, members: [
          { type: 'way', geometry: [a, b] },
          { type: 'way', role: 'backward', geometry: [c, b] },
        ],
      }],
    }), { status: 200 })))
    const out = await fetchTrailGeometryDirect(77)
    expect(out?.ok).toBe(true)
    if (out?.ok) {
      expect(out.data.sourceSegments[1]).toEqual([[b.lat, b.lon], [c.lat, c.lon]])
      expect(out.data.sourceSegmentDirectionLocked).toEqual([false, true])
    }
  })

  it('direct : un rôle de section hiking reste réversible et supporté', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      elements: [{
        type: 'relation', id: 78, tags: { route: 'hiking' }, members: [
          { type: 'way', role: 'main', geometry: GEOM },
        ],
      }],
    }), { status: 200 })))
    const out = await fetchTrailGeometryDirect(78)
    expect(out?.ok).toBe(true)
    if (out?.ok) {
      expect(out.data.sourceSegmentDirectionLocked).toEqual([false])
      expect(out.data.integrity?.unsupportedWayRoles).toEqual([])
    }
  })

  it('direct : une branche optionnelle est signalée, jamais fondue dans le circuit canonique', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      elements: [{
        type: 'relation', id: 79, tags: { route: 'hiking' }, members: [
          { type: 'way', role: 'alternative', geometry: GEOM },
        ],
      }],
    }), { status: 200 })))
    const out = await fetchTrailGeometryDirect(79)
    expect(out?.ok).toBe(true)
    if (out?.ok) expect(out.data.integrity?.unsupportedWayRoles).toEqual(['alternative'])
  })

  it('direct : un remark HTTP 200 bascule sur le miroir suivant', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ remark: 'runtime error', elements: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(OVERPASS_BODY), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchTrailGeometryDirect(222)
    expect(out?.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
