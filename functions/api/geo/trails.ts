import type { Env } from '../../env'
import { checkAllowedUserPeek, notFoundResponse, type AllowedUser } from '../_lib/checkAllowedUser'
import {
  consumeOwnerApiQuota,
  ownerApiLimitResponse,
  planSubjectToOwnerApiCap,
} from '../_lib/freeQuota'
import { simplifySegments } from '../_lib/simplify'

// ─────────────────────────────────────────────────────────────────────────────
// Recherche de sentiers OpenStreetMap + géométrie pour export GPX.
//
// Deux actions sur le même endpoint (POST /api/geo/trails) :
//  - { action:'search', location, radiusKm?, kind? } → circuits balisés
//    (relations route=horse/hiking/foot/bicycle/mtb) autour d'un lieu, avec
//    longueur calculée et stats du réseau de chemins — SANS géométrie (elle
//    ne sert à rien au LLM et gonflerait le contexte).
//  - { action:'geometry', routeId } → géométrie d'une relation pour générer
//    le GPX côté client. Stateless : pas de session serveur entre les deux
//    appels, le cache HTTP fait le travail.
//
// Sources upstream : Overpass API (gratuit, sans clé) + géocodage open-meteo
// (déjà utilisé par browser/weather.ts) avec repli Nominatim pour les adresses.
// Ces services communautaires BANNISSENT les IP abusives, et l'IP egress
// Cloudflare est partagée → défenses (RÈGLE 6, abus infra) :
//  - auth checkAllowedUserPeek (anti-relais anonyme, CRIT-4)
//  - cap journalier 'osm-trails' (25/j) pour les plans free/trial
//  - cache Cloudflare 24 h (les sentiers ne bougent pas) AVANT tout upstream
//  - User-Agent identifiant + timeout + redirect:'error' sur chaque fetch
//  - réponse Overpass bornée (Content-Length + lecture plafonnée 5 Mo)
// Le texte utilisateur n'entre JAMAIS dans le QL Overpass : seuls des nombres
// validés (lat/lon/rayon) ou un id numérique y sont interpolés.
// ─────────────────────────────────────────────────────────────────────────────

const USER_AGENT = 'Arty/1.0 (+https://tryarty.com)'
const OVERPASS_INSTANCES = [
  // Ordre empirique (sondes 19 juil. 2026) : l'instance principale rend en ~2 s
  // quand elle n'est pas saturée ; maps.mail.ru est un miroir stable et rapide.
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
const MAX_UPSTREAM_BYTES = 5 * 1024 * 1024
const MAX_ROUTES = 12
const MAX_GEOMETRY_POINTS = 4000
const CACHE_TTL_SECONDS = 86400

// La valeur regex vient de cette map FIXE, jamais du texte utilisateur.
const KIND_FILTERS: Record<string, string> = {
  horse: '^horse$',
  hiking: '^(hiking|foot)$',
  bike: '^(bicycle|mtb)$',
  all: '^(horse|hiking|foot|bicycle|mtb)$',
}

interface OverpassGeomPoint { lat: number; lon: number }
interface OverpassMember { type: string; role?: string; geometry?: OverpassGeomPoint[] }
interface OverpassElement {
  type: string
  id: number
  tags?: Record<string, string>
  members?: OverpassMember[]
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const allowed = await checkAllowedUserPeek(request, env)
  if (!allowed) return notFoundResponse()

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return notFoundResponse()
  }

  const action = body.action === 'geometry' ? 'geometry' : 'search'

  try {
    if (action === 'geometry') {
      return await handleGeometry(env, allowed, body)
    }
    return await handleSearch(env, allowed, body)
  } catch (err) {
    // Log serveur uniquement — le client reçoit une erreur générique, jamais
    // le status/body upstream (règle N-2).
    console.error('[geo/trails] failed', err instanceof Error ? err.message : err)
    return Response.json({ error: 'Service indisponible' }, { status: 502 })
  }
}

// ── Recherche ────────────────────────────────────────────────────────────────

async function handleSearch(env: Env, allowed: AllowedUser, body: Record<string, unknown>): Promise<Response> {
  const location = typeof body.location === 'string' ? body.location.trim() : ''
  if (!location || location.length > 120) {
    return Response.json({ error: 'Paramètre location requis (max 120)' }, { status: 400 })
  }
  const radiusKm = clampRadius(body.radiusKm)
  const kind = typeof body.kind === 'string' && KIND_FILTERS[body.kind] ? body.kind : 'all'

  const center = await resolveCenter(env, allowed, location)
  if (!center) {
    return Response.json({ error: 'Lieu introuvable' }, { status: 404 })
  }

  // Clé de cache : coords arrondies à ~110 m — deux demandes voisines dans le
  // même village partagent l'entrée, et la clé ne peut pas exploser en variantes.
  const cacheKey = cacheRequest(
    `search/${center.lat.toFixed(3)}/${center.lon.toFixed(3)}/${radiusKm}/${kind}`
  )
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const capResponse = await enforceQuota(env, allowed)
  if (capResponse) return capResponse

  const radiusM = Math.round(radiusKm * 1000)
  const pad = (radiusM + 500) / 111_320 // ≈ degrés de latitude par mètre
  const south = (center.lat - pad).toFixed(6)
  const north = (center.lat + pad).toFixed(6)
  // Longitude : resserrée par le cosinus de la latitude (borné pour éviter /0
  // aux pôles — hors cas d'usage réel mais les coords libres l'autorisent).
  const lonPad = pad / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180))
  const west = (center.lon - lonPad).toFixed(6)
  const east = (center.lon + lonPad).toFixed(6)

  // `out geom(bbox)` CLIPPE la géométrie au cadre de recherche : un GR national
  // qui traverse la zone ne renvoie que son tronçon local (pas 700 km de trace).
  const ql =
    `[out:json][timeout:10];` +
    `relation["type"="route"]["route"~"${KIND_FILTERS[kind]}"](around:${radiusM},${center.lat.toFixed(6)},${center.lon.toFixed(6)});` +
    `out geom(${south},${west},${north},${east}) 40;` +
    `way["highway"~"^(track|path|bridleway)$"](around:3000,${center.lat.toFixed(6)},${center.lon.toFixed(6)});` +
    `out count;`

  const data = await queryOverpass(ql)

  const routes: Array<{
    id: number
    name: string
    kind: string
    network: string | null
    longDistance: boolean
    distanceKm: number
    colour: string | null
    symbol: string | null
    website: string | null
    note: string | null
  }> = []
  let nearbyPathCount = 0

  for (const el of data.elements ?? []) {
    if (el.type === 'count') {
      nearbyPathCount = Number(el.tags?.total ?? el.tags?.ways ?? 0) || 0
      continue
    }
    if (el.type !== 'relation') continue
    const tags = el.tags ?? {}
    const segments = memberSegments(el)
    const km = segments.reduce((sum, seg) => sum + segmentKm(seg), 0)
    if (km < 0.05) continue // relation sans géométrie exploitable dans la zone
    const network = tags.network ?? null
    routes.push({
      id: el.id,
      name: routeLabel(tags, el.id),
      kind: tags.route ?? 'hiking',
      network,
      // iwn/nwn/rwn = itinéraire international/national/régional : la longueur
      // calculée n'est que le tronçon clippé dans la zone — à annoncer comme tel.
      longDistance: /^(iwn|nwn|rwn|icn|ncn|rcn)$/.test(network ?? ''),
      distanceKm: Math.round(km * 10) / 10,
      colour: tags.colour ?? null,
      symbol: tags['osmc:symbol'] ?? null,
      website: tags.website ?? null,
      note: tags.description ?? tags.note ?? null,
    })
  }

  // Priorité : équestre d'abord (le cas d'usage), puis réseaux locaux (les
  // boucles proches), puis le reste — à longueur croissante dans chaque groupe.
  const groupOf = (r: (typeof routes)[number]) =>
    r.kind === 'horse' ? 0 : r.longDistance ? 2 : 1
  routes.sort((a, b) => groupOf(a) - groupOf(b) || a.distanceKm - b.distanceKm)

  const response = Response.json({
    center,
    radiusKm,
    kind,
    routes: routes.slice(0, MAX_ROUTES),
    totalFound: routes.length,
    nearbyPathCount,
  })
  await cachePut(cacheKey, response.clone())
  return response
}

// ── Géométrie (export GPX) ───────────────────────────────────────────────────

async function handleGeometry(env: Env, allowed: AllowedUser, body: Record<string, unknown>): Promise<Response> {
  const routeId = Number(body.routeId)
  if (!Number.isInteger(routeId) || routeId <= 0 || routeId > Number.MAX_SAFE_INTEGER) {
    return Response.json({ error: 'Paramètre routeId invalide' }, { status: 400 })
  }

  const cacheKey = cacheRequest(`geometry/${routeId}`)
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const capResponse = await enforceQuota(env, allowed)
  if (capResponse) return capResponse

  const data = await queryOverpass(`[out:json][timeout:10];relation(id:${routeId});out geom;`)
  const rel = (data.elements ?? []).find((e) => e.type === 'relation' && e.id === routeId)
  if (!rel) {
    return Response.json({ error: 'Circuit introuvable' }, { status: 404 })
  }

  const tags = rel.tags ?? {}
  const sourceSegments = memberSegments(rel)
  // Longueur TOUJOURS calculée sur la géométrie source — jamais sur la version
  // simplifiée (sinon la distance affichée et le GPX mentent sur le terrain).
  const sourcePointCount = sourceSegments.reduce((n, s) => n + s.length, 0)
  const distanceKm = Math.round(sourceSegments.reduce((sum, s) => sum + segmentKm(s), 0) * 10) / 10
  // Douglas-Peucker par segment (extrémités et segments disjoints préservés),
  // jamais de troncature — cf. functions/api/_lib/simplify.ts.
  const { segments, toleranceM } = simplifySegments(sourceSegments, MAX_GEOMETRY_POINTS)
  if (segments.length === 0) {
    return Response.json({ error: 'Circuit introuvable' }, { status: 404 })
  }

  const response = Response.json({
    id: rel.id,
    name: routeLabel(tags, rel.id),
    kind: tags.route ?? 'hiking',
    distanceKm,
    segments,
    simplified: { toleranceM, sourcePointCount },
  })
  await cachePut(cacheKey, response.clone())
  return response
}

// ── Géocodage ────────────────────────────────────────────────────────────────

async function resolveCenter(
  env: Env,
  allowed: AllowedUser,
  location: string
): Promise<{ lat: number; lon: number; label: string } | null> {
  // Coords GPS directes « lat,lon » (position utilisateur) — pas de géocodage.
  const coords = location.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (coords) {
    const lat = Number(coords[1])
    const lon = Number(coords[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null
    }
    return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` }
  }

  // Cache du géocodage lui-même : évite de re-frapper open-meteo/Nominatim
  // pour le même lieu, et absorbe la contrainte « 1 req/s » de Nominatim.
  const cacheKey = cacheRequest(`geocode/${encodeURIComponent(location.toLowerCase())}`)
  const cached = await cacheGet(cacheKey)
  if (cached) {
    try {
      return (await cached.json()) as { lat: number; lon: number; label: string }
    } catch { /* entrée illisible → re-géocode */ }
  }

  // 1) open-meteo (villes/villages — même service que browser/weather.ts).
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=fr`,
      { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(8000) }
    )
    if (res.ok) {
      const geo = (await res.json()) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
      const hit = geo.results?.[0]
      if (hit && Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)) {
        const center = { lat: hit.latitude, lon: hit.longitude, label: hit.name }
        await cachePut(cacheKey, Response.json(center))
        return center
      }
    }
  } catch (err) {
    console.warn('[geo/trails] open-meteo geocode failed', err instanceof Error ? err.message : err)
  }

  // 2) Repli Nominatim (adresses précises type « 191 chemin des bouviers »).
  // Politique Nominatim : User-Agent identifiant OBLIGATOIRE, usage modéré —
  // garanti ici par le cache ci-dessus + le cap journalier appelant.
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=jsonv2&limit=1&accept-language=fr`,
      { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(8000) }
    )
    if (res.ok) {
      const results = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>
      const hit = results?.[0]
      const lat = Number(hit?.lat)
      const lon = Number(hit?.lon)
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        const center = { lat, lon, label: (hit.display_name ?? location).slice(0, 120) }
        await cachePut(cacheKey, Response.json(center))
        return center
      }
    }
  } catch (err) {
    console.warn('[geo/trails] nominatim geocode failed', err instanceof Error ? err.message : err)
  }

  return null
}

// ── Overpass ─────────────────────────────────────────────────────────────────

async function queryOverpass(ql: string): Promise<{ elements?: OverpassElement[] }> {
  let lastError: unknown = null
  for (const instance of OVERPASS_INSTANCES) {
    try {
      const res = await fetch(instance, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(ql)}`,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) {
        lastError = new Error(`overpass ${res.status}`)
        continue
      }
      const contentLength = Number(res.headers.get('content-length') ?? 0)
      if (contentLength > MAX_UPSTREAM_BYTES) {
        lastError = new Error('overpass response too large')
        continue
      }
      const text = await readBounded(res, MAX_UPSTREAM_BYTES)
      return JSON.parse(text) as { elements?: OverpassElement[] }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('overpass unavailable')
}

/** Lit un body en le plafonnant — Overpass peut répondre en chunked sans
 *  Content-Length ; un `res.json()` non borné exposerait la mémoire du Worker. */
async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return res.text()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('overpass response too large')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

// ── Helpers géométrie / divers ───────────────────────────────────────────────

function memberSegments(rel: OverpassElement): Array<Array<[number, number]>> {
  const segments: Array<Array<[number, number]>> = []
  for (const member of rel.members ?? []) {
    if (member.type !== 'way' || !Array.isArray(member.geometry)) continue
    const points = member.geometry
      .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
      .map((p) => [p.lat, p.lon] as [number, number])
    if (points.length >= 2) segments.push(points)
  }
  return segments
}

function segmentKm(points: Array<[number, number]>): number {
  let meters = 0
  for (let i = 1; i < points.length; i++) {
    meters += haversineM(points[i - 1], points[i])
  }
  return meters / 1000
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function routeLabel(tags: Record<string, string>, id: number): string {
  if (tags.name) return tags.name
  if (tags.from && tags.to) return `${tags.from} → ${tags.to}`
  if (tags.ref) return `Circuit ${tags.ref}`
  const colour = tags.colour ? ` (balisage ${tags.colour})` : ''
  return `Segment balisé${colour} #${id}`
}

function clampRadius(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 6
  return Math.min(15, Math.max(1, Math.round(n)))
}

async function enforceQuota(env: Env, allowed: AllowedUser): Promise<Response | null> {
  if (!planSubjectToOwnerApiCap(allowed.planType)) return null
  const cap = await consumeOwnerApiQuota(env, allowed.email, 'osm-trails')
  if (!cap.allowed) return ownerApiLimitResponse('osm-trails', cap.limit)
  return null
}

// ── Cache Cloudflare (best-effort : absent en tests node, jamais bloquant) ──

function cacheRequest(key: string): Request {
  return new Request(`https://trails-cache.arty.internal/${key}`, { method: 'GET' })
}

async function cacheGet(key: Request): Promise<Response | null> {
  try {
    const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
    if (!cache) return null
    const hit = await cache.match(key)
    return hit ?? null
  } catch {
    return null
  }
}

async function cachePut(key: Request, response: Response): Promise<void> {
  try {
    const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default
    if (!cache) return
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`)
    await cache.put(key, new Response(response.body, { status: response.status, headers }))
  } catch {
    // best-effort
  }
}
