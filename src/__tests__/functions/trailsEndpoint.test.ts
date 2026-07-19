// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/geo/trails'
import { OWNER_API_DAILY_LIMITS } from '../../../functions/api/_lib/freeQuota'

// Feature sentiers/GPX (juillet 2026) — le endpoint est le seul pont vers
// Overpass/Nominatim : auth stricte, QL numérique, fallback d'instances,
// erreurs génériques (règle N-2), réponse bornée.

const EMAIL = 'flo@example.com'
const env = {
  GOOGLE_CLIENT_ID: 'arty-client-id',
  ALLOWED_EMAILS: EMAIL, // → planType 'vip', pas de D1 nécessaire
} as unknown

function req(body: unknown, withToken = true): Request {
  return new Request('https://tryarty.com/api/geo/trails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withToken ? { 'x-google-token': 'tok' } : {}),
    },
    body: JSON.stringify(body),
  })
}

// Géométrie factice : 3 points espacés d'environ 100 m.
const GEOM = [
  { lat: 45.3, lon: 5.2 },
  { lat: 45.3009, lon: 5.2 },
  { lat: 45.3018, lon: 5.2 },
]

const OVERPASS_SEARCH_BODY = {
  elements: [
    {
      type: 'relation',
      id: 111,
      tags: { type: 'route', route: 'hiking', network: 'lwn', colour: 'yellow' },
      members: [{ type: 'way', geometry: GEOM }],
    },
    {
      type: 'relation',
      id: 222,
      tags: { type: 'route', route: 'horse', name: 'Boucle des Bouviers' },
      members: [{ type: 'way', geometry: GEOM }],
    },
    {
      type: 'relation',
      id: 333,
      tags: { type: 'route', route: 'hiking', network: 'rwn', name: 'GR de pays' },
      members: [{ type: 'way', geometry: GEOM }],
    },
    { type: 'count', id: 0, tags: { total: '99', ways: '99' } },
  ],
}

function stubFetch(overpass: (url: string, init?: RequestInit) => Response | null) {
  const spy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/tokeninfo')) {
      return new Response(JSON.stringify({ aud: 'arty-client-id' }), { status: 200 })
    }
    if (u.includes('/oauth2/v2/userinfo')) {
      return new Response(JSON.stringify({ id: 'g-1', email: EMAIL, verified_email: true }), { status: 200 })
    }
    if (u.includes('api-adresse.data.gouv.fr')) {
      // Par défaut la BAN ne matche pas → la chaîne passe à open-meteo.
      return new Response(JSON.stringify({ features: [] }), { status: 200 })
    }
    if (u.includes('geocoding-api.open-meteo.com')) {
      return new Response(
        JSON.stringify({ results: [{ latitude: 45.313, longitude: 5.204, name: 'Viriville' }] }),
        { status: 200 }
      )
    }
    if (u.includes('overpass') || u.includes('maps.mail.ru')) {
      const r = overpass(u, init)
      if (r) return r
      throw new Error('unexpected overpass fetch ' + u)
    }
    throw new Error('unexpected fetch ' + u)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}
afterEach(() => vi.unstubAllGlobals())

const call = (r: Request) => onRequestPost({ request: r, env } as never)

describe('geo/trails — auth (RÈGLE 6)', () => {
  it('sans token Google → 404 uniforme, aucun appel upstream', async () => {
    const spy = stubFetch(() => new Response('{}'))
    const res = await call(req({ action: 'search', location: 'Viriville' }, false))
    expect(res.status).toBe(404)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('overpass'))).toBe(false)
  })

  it("token d'une autre app OAuth (aud étranger) → 404 uniforme", async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/tokeninfo')) return new Response(JSON.stringify({ aud: 'evil-app' }), { status: 200 })
      return new Response('{}', { status: 200 })
    }))
    const res = await call(req({ action: 'search', location: 'Viriville' }))
    expect(res.status).toBe(404)
  })
})

describe('geo/trails — validation des entrées', () => {
  it('location absente ou trop longue → 400', async () => {
    stubFetch(() => new Response('{}'))
    expect((await call(req({ action: 'search' }))).status).toBe(400)
    expect((await call(req({ action: 'search', location: 'x'.repeat(121) }))).status).toBe(400)
  })

  it('routeId non entier → 400 sans appel upstream', async () => {
    const spy = stubFetch(() => new Response('{}'))
    expect((await call(req({ action: 'geometry', routeId: 'DROP TABLE' }))).status).toBe(400)
    expect((await call(req({ action: 'geometry', routeId: -3 }))).status).toBe(400)
    expect((await call(req({ action: 'geometry', routeId: 1.5 }))).status).toBe(400)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('overpass'))).toBe(false)
  })

  it('coords hors plage → 404 lieu introuvable (pas de QL généré)', async () => {
    const spy = stubFetch(() => new Response('{}'))
    const res = await call(req({ action: 'search', location: '245.0,5.2' }))
    expect(res.status).toBe(404)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('overpass'))).toBe(false)
  })
})

describe('geo/trails — recherche', () => {
  it('coords directes : QL numérique pur, tri horse > local > longue distance, count parsé', async () => {
    let capturedQl = ''
    stubFetch((_u, init) => {
      capturedQl = decodeURIComponent(String(init?.body ?? ''))
      return new Response(JSON.stringify(OVERPASS_SEARCH_BODY), { status: 200 })
    })
    const res = await call(req({ action: 'search', location: '45.313,5.204', radiusKm: 8, kind: 'all' }))
    expect(res.status).toBe(200)
    const data = await res.json() as {
      routes: Array<{ id: number; name: string; longDistance: boolean; distanceKm: number }>
      nearbyPathCount: number
    }
    // Le texte utilisateur n'entre jamais dans le QL — uniquement des nombres.
    expect(capturedQl).toContain('around:8000,45.313000,5.204000')
    expect(capturedQl).not.toContain('Viriville')
    // Tri : équestre d'abord, réseau local ensuite, longue distance en dernier.
    expect(data.routes.map((r) => r.id)).toEqual([222, 111, 333])
    expect(data.routes[0].name).toBe('Boucle des Bouviers')
    expect(data.routes[2].longDistance).toBe(true)
    expect(data.routes[0].distanceKm).toBeGreaterThan(0.1)
    expect(data.nearbyPathCount).toBe(99)
    // La géométrie ne sort JAMAIS en mode search (tokens + surface d'injection).
    expect(JSON.stringify(data)).not.toContain('"geometry"')
    expect(JSON.stringify(data)).not.toContain('"segments"')
  })

  it('nom de lieu : géocodé (BAN sans résultat → open-meteo) avant Overpass', async () => {
    stubFetch(() => new Response(JSON.stringify(OVERPASS_SEARCH_BODY), { status: 200 }))
    const res = await call(req({ action: 'search', location: 'Viriville' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { center: { label: string } }
    expect(data.center.label).toBe('Viriville')
  })

  it("l'API Adresse (BAN) prime quand elle matche avec un bon score", async () => {
    const spy = stubFetch(() => new Response(JSON.stringify(OVERPASS_SEARCH_BODY), { status: 200 }))
    spy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes('/tokeninfo')) return new Response(JSON.stringify({ aud: 'arty-client-id' }), { status: 200 })
      if (u.includes('/oauth2/v2/userinfo')) {
        return new Response(JSON.stringify({ id: 'g-1', email: EMAIL, verified_email: true }), { status: 200 })
      }
      if (u.includes('api-adresse.data.gouv.fr')) {
        return new Response(JSON.stringify({
          features: [{ geometry: { coordinates: [5.205671, 45.311889] }, properties: { label: 'Viriville (38980)', score: 0.94 } }],
        }), { status: 200 })
      }
      if (u.includes('overpass')) return new Response(JSON.stringify(OVERPASS_SEARCH_BODY), { status: 200 })
      throw new Error('unexpected fetch ' + u)
    })
    const res = await call(req({ action: 'search', location: 'Viriville Isère' }))
    expect(res.status).toBe(200)
    const data = await res.json() as { center: { label: string } }
    // open-meteo n'est jamais appelé (il ne connaît pas « Viriville Isère »)
    expect(data.center.label).toBe('Viriville (38980)')
    expect(spy.mock.calls.some((c) => String(c[0]).includes('open-meteo'))).toBe(false)
  })

  it('rayon par défaut = 10 km (leçon terrain : 6 km rate les circuits ruraux)', async () => {
    let capturedQl = ''
    stubFetch((_u, init) => {
      capturedQl = decodeURIComponent(String(init?.body ?? ''))
      return new Response(JSON.stringify(OVERPASS_SEARCH_BODY), { status: 200 })
    })
    const res = await call(req({ action: 'search', location: '45.313,5.204' }))
    expect(res.status).toBe(200)
    expect(capturedQl).toContain('around:10000,')
  })

  it("bascule sur l'instance suivante quand la première est saturée (504)", async () => {
    const seen: string[] = []
    stubFetch((u) => {
      seen.push(u)
      if (u.includes('overpass-api.de')) return new Response('busy', { status: 504 })
      return new Response(JSON.stringify(OVERPASS_SEARCH_BODY), { status: 200 })
    })
    const res = await call(req({ action: 'search', location: '45.313,5.204' }))
    expect(res.status).toBe(200)
    // 2e instance = overpass.openstreetmap.fr (ordre UE d'abord, mail.ru en
    // dernier recours — RÈGLE 5).
    expect(seen.some((u) => u.includes('overpass.openstreetmap.fr'))).toBe(true)
    expect(seen.some((u) => u.includes('maps.mail.ru'))).toBe(false)
  })

  it('toutes les instances down → 502 générique sans détail upstream (N-2)', async () => {
    stubFetch(() => new Response('Dispatcher_Client::request_read_and_idx::timeout', { status: 504 }))
    const res = await call(req({ action: 'search', location: '45.313,5.204' }))
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Service indisponible')
    expect(JSON.stringify(body)).not.toContain('Dispatcher')
  })
})

describe('geo/trails — géométrie (export GPX)', () => {
  it('renvoie les segments et décime au-delà du plafond de points', async () => {
    const bigGeom = Array.from({ length: 9000 }, (_, i) => ({ lat: 45.3 + i * 1e-5, lon: 5.2 }))
    stubFetch(() =>
      new Response(
        JSON.stringify({
          elements: [{
            type: 'relation',
            id: 555,
            tags: { type: 'route', route: 'horse', name: 'Grande boucle' },
            members: [{ type: 'way', geometry: bigGeom }],
          }],
        }),
        { status: 200 }
      )
    )
    const res = await call(req({ action: 'geometry', routeId: 555 }))
    expect(res.status).toBe(200)
    const data = await res.json() as { name: string; distanceKm: number; segments: Array<Array<[number, number]>> }
    expect(data.name).toBe('Grande boucle')
    const totalPoints = data.segments.reduce((n, s) => n + s.length, 0)
    expect(totalPoints).toBeLessThanOrEqual(4001) // plafond + extrémité conservée
    expect(data.distanceKm).toBeGreaterThan(5)
  })

  it('relation inconnue → 404 générique', async () => {
    stubFetch(() => new Response(JSON.stringify({ elements: [] }), { status: 200 }))
    expect((await call(req({ action: 'geometry', routeId: 999999 }))).status).toBe(404)
  })
})

describe('geo/trails — cap journalier', () => {
  it("la famille 'osm-trails' est déclarée avec un cap raisonnable", () => {
    expect(OWNER_API_DAILY_LIMITS['osm-trails']).toBeGreaterThanOrEqual(10)
    expect(OWNER_API_DAILY_LIMITS['osm-trails']).toBeLessThanOrEqual(100)
  })
})
