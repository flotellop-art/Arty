import type { Env } from '../../env'
import { checkAllowedUserPeek, notFoundResponse, type AllowedUser } from '../_lib/checkAllowedUser'
import {
  consumeOwnerApiQuota,
  ownerApiLimitResponse,
  planSubjectToOwnerApiCap,
} from '../_lib/freeQuota'
import { simplifySegments } from '../_lib/simplify'
import { segmentsKmWithinRadius } from '../_lib/geoDistance'

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
  // UE uniquement : la requête peut contenir des coordonnées proches du
  // domicile. On ne les transfère pas à un miroir hors UE en dernier recours.
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]
const MAX_UPSTREAM_BYTES = 5 * 1024 * 1024
const MAX_ROUTES = 12
const MAX_GEOMETRY_BATCH = 3
const MAX_GEOMETRY_POINTS = 4000
const MAX_SAFE_DISPLAY_POINTS = 20_000
const CACHE_TTL_SECONDS = 86400

// La valeur regex vient de cette map FIXE, jamais du texte utilisateur.
const KIND_FILTERS: Record<string, string> = {
  horse: '^horse$',
  hiking: '^(hiking|foot)$',
  bike: '^(bicycle|mtb)$',
  all: '^(horse|hiking|foot|bicycle|mtb)$',
}

interface OverpassGeomPoint { lat: number; lon: number }
interface OverpassMember { type: string; role?: string; geometry?: Array<OverpassGeomPoint | null> }
interface OverpassElement {
  type: string
  id: number
  tags?: Record<string, string>
  members?: OverpassMember[]
}
interface OverpassPayload { elements?: OverpassElement[]; remark?: string }

// Les branches optionnelles sont signalées comme non supportées : les inclure
// toutes donnerait une distance/trace faussement canonique.
const REVERSIBLE_WAY_ROLES = new Set(['', 'main'])

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const allowed = await checkAllowedUserPeek(request, env)
  if (!allowed) return notFoundResponse()

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return notFoundResponse()
  }

  const action = body.action === 'geometry' || body.action === 'geometries' ? body.action : 'search'

  try {
    if (action === 'geometry') {
      return await handleGeometry(env, allowed, body)
    }
    if (action === 'geometries') {
      return await handleGeometries(env, allowed, body)
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

  // Clé de cache au mètre près : deux domiciles voisins ne doivent pas recevoir
  // les distances locales calculées depuis le centre de l'autre.
  const searchKey = await cacheDigest(`${center.lat.toFixed(5)}/${center.lon.toFixed(5)}/${radiusKm}/${kind}`)
  const cacheKey = cacheRequest(`search-v4/${searchKey}`)
  const cached = await cacheGet(cacheKey)
  if (cached) {
    try {
      // Le centre exact, qui peut être le domicile, n'est jamais stocké dans
      // la valeur de cache partagée.
      const publicResult = await cached.json() as Record<string, unknown>
      return Response.json({ ...publicResult, center })
    } catch { /* cache ancien/corrompu → requête fraîche */ }
  }

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
    `[out:json][timeout:8];` +
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
    const { segments } = memberSegments(el)
    const km = segmentsKmWithinRadius(segments, center, radiusM)
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

  const publicResult = {
    radiusKm,
    kind,
    routes: routes.slice(0, MAX_ROUTES),
    totalFound: routes.length,
    nearbyPathCount,
  }
  // Cache partagé : uniquement les données OSM publiques. Le centre précis et
  // son libellé restent dans la réponse privée construite pour cette requête.
  await cachePut(cacheKey, Response.json(publicResult))
  return Response.json({ ...publicResult, center })
}

// ── Géométrie (export GPX) ───────────────────────────────────────────────────

async function handleGeometry(env: Env, allowed: AllowedUser, body: Record<string, unknown>): Promise<Response> {
  const routeId = Number(body.routeId)
  if (!Number.isInteger(routeId) || routeId <= 0 || routeId > Number.MAX_SAFE_INTEGER) {
    return Response.json({ error: 'Paramètre routeId invalide' }, { status: 400 })
  }

  // v2 sépare géométrie source (GPX/distance) et géométrie d'affichage.
  // Versionner la clé évite de resservir pendant 24 h l'ancien contrat.
  const cacheKey = cacheRequest(`geometry-v3/${routeId}`)
  const cached = await cacheGet(cacheKey)
  if (cached) return cached

  const capResponse = await enforceQuota(env, allowed)
  if (capResponse) return capResponse

  const data = await queryOverpass(`[out:json][timeout:8];relation(id:${routeId});out geom;`)
  const rel = (data.elements ?? []).find((e) => e.type === 'relation' && e.id === routeId)
  if (!rel) {
    return Response.json({ error: 'Circuit introuvable' }, { status: 404 })
  }

  const geometry = geometryFromRelation(rel)
  if (geometry.sourceSegments.length === 0) {
    return Response.json({ error: 'Circuit introuvable' }, { status: 404 })
  }

  const response = Response.json(geometry)
  await cachePut(cacheKey, response.clone())
  return response
}

function geometryFromRelation(rel: OverpassElement) {
  const tags = rel.tags ?? {}
  const { segments: sourceSegments, directionLocked: sourceSegmentDirectionLocked } = memberSegments(rel)
  // Longueur TOUJOURS calculée sur la géométrie source — jamais sur la version
  // simplifiée (sinon la distance affichée et le GPX mentent sur le terrain).
  const sourcePointCount = sourceSegments.reduce((n, s) => n + s.length, 0)
  const exactDistanceKm = sourceSegments.reduce((sum, s) => sum + segmentKm(s), 0)
  const distanceMeters = Math.round(exactDistanceKm * 1000)
  const distanceKm = Math.round(exactDistanceKm * 10) / 10
  // Douglas-Peucker par segment, uniquement pour l'affichage et avec une
  // erreur maximale de 5 m. Le GPX reçoit toujours `sourceSegments`.
  const { segments: displaySegments, toleranceM } = simplifySegments(sourceSegments, MAX_GEOMETRY_POINTS, 5)
  const displayPointCount = displaySegments.reduce((n, s) => n + s.length, 0)
  return {
    id: rel.id,
    name: routeLabel(tags, rel.id),
    kind: tags.route ?? 'hiking',
    distanceKm,
    distanceMeters,
    sourceSegments,
    sourceSegmentDirectionLocked,
    displaySegments,
    simplified: { toleranceM, sourcePointCount, displayPointCount },
    integrity: {
      hasNestedRelations: (rel.members ?? []).some((member) => member.type === 'relation'),
      unsupportedWayRoles: [...new Set(
        (rel.members ?? [])
          .filter((member) => member.type === 'way' && !REVERSIBLE_WAY_ROLES.has(member.role ?? '') && member.role !== 'forward' && member.role !== 'backward')
          .map((member) => member.role as string)
      )],
      displaySafe: displayPointCount <= MAX_SAFE_DISPLAY_POINTS,
    },
    provenance: { provider: 'OpenStreetMap' as const, relationId: rel.id, fetchedAt: Date.now() },
  }
}

async function handleGeometries(env: Env, allowed: AllowedUser, body: Record<string, unknown>): Promise<Response> {
  const rawIds = Array.isArray(body.routeIds) ? body.routeIds : []
  const routeIds = [...new Set(rawIds.map(Number))]
  if (
    routeIds.length === 0 || routeIds.length > MAX_GEOMETRY_BATCH ||
    routeIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    return Response.json({ error: 'Paramètre routeIds invalide' }, { status: 400 })
  }

  const byId = new Map<number, ReturnType<typeof geometryFromRelation>>()
  for (const routeId of routeIds) {
    const cached = await cacheGet(cacheRequest(`geometry-v3/${routeId}`))
    if (!cached) continue
    try {
      const geometry = await cached.json() as ReturnType<typeof geometryFromRelation>
      if (geometry.id === routeId && Array.isArray(geometry.sourceSegments)) byId.set(routeId, geometry)
    } catch { /* entrée illisible → recharger cet id */ }
  }

  const missingIds = routeIds.filter((routeId) => !byId.has(routeId))
  if (missingIds.length > 0) {
    const capResponse = await enforceQuota(env, allowed)
    if (capResponse) return capResponse
    const data = await queryOverpass(`[out:json][timeout:8];relation(id:${missingIds.join(',')});out geom;`)
    for (const element of data.elements ?? []) {
      if (element.type !== 'relation' || !missingIds.includes(element.id)) continue
      const geometry = geometryFromRelation(element)
      if (geometry.sourceSegments.length === 0) continue
      byId.set(element.id, geometry)
      await cachePut(cacheRequest(`geometry-v3/${element.id}`), Response.json(geometry))
    }
  }
  const trails = routeIds
    .map((id) => byId.get(id))
    .filter((trail): trail is NonNullable<typeof trail> => !!trail && trail.sourceSegments.length > 0)
  if (trails.length === 0) {
    return Response.json({ error: 'Circuit introuvable' }, { status: 404 })
  }
  return Response.json({ trails })
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

  // Cache du géocodage lui-même : évite de re-frapper les géocodeurs pour le
  // même lieu, et absorbe la contrainte « 1 req/s » de Nominatim.
  const cacheKey = cacheRequest(`geocode-v2/${await cacheDigest(location.toLowerCase())}`)
  const cached = await cacheGet(cacheKey)
  if (cached) {
    try {
      return (await cached.json()) as { lat: number; lon: number; label: string }
    } catch { /* entrée illisible → re-géocode */ }
  }

  // Chaîne re-priorisée après le premier test terrain (19 juil.) : depuis les
  // IP egress Cloudflare partagées, Nominatim (anti-datacenter) et open-meteo
  // peuvent refuser/limiter. L'API Adresse (adresse.data.gouv.fr) est CONÇUE
  // pour l'appel programmatique, couvre communes ET adresses françaises
  // (« 191 chemin des bouviers Viriville ») et gère « Viriville Isère » —
  // qu'open-meteo ne résout pas. Timeouts 5 s : la chaîne complète doit tenir
  // sous le budget client avec les deux instances Overpass derrière.
  const center =
    (await geocodeBanFrance(location)) ??
    (await geocodeOpenMeteo(location)) ??
    (await geocodeNominatim(location))
  if (center) await cachePut(cacheKey, Response.json(center))
  return center
}

/** API Adresse (Base Adresse Nationale) — gouvernement français, sans clé. */
async function geocodeBanFrance(location: string): Promise<{ lat: number; lon: number; label: string } | null> {
  try {
    const res = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(location)}&limit=1`,
      { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const geo = (await res.json()) as {
      features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { label?: string; score?: number } }>
    }
    const hit = geo.features?.[0]
    const lon = hit?.geometry?.coordinates?.[0]
    const lat = hit?.geometry?.coordinates?.[1]
    // Score < 0.4 = correspondance douteuse (la BAN renvoie toujours quelque
    // chose) → laisser la main aux géocodeurs mondiaux plutôt que de partir
    // sur une mauvaise commune.
    if ((hit?.properties?.score ?? 0) < 0.4) return null
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat: lat as number, lon: lon as number, label: (hit?.properties?.label ?? location).slice(0, 120) }
  } catch (err) {
    console.warn('[geo/trails] ban geocode failed', err instanceof Error ? err.message : err)
    return null
  }
}

/** open-meteo (mondial, villes/villages — même service que browser/weather.ts). */
async function geocodeOpenMeteo(location: string): Promise<{ lat: number; lon: number; label: string } | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=fr`,
      { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const geo = (await res.json()) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
    const hit = geo.results?.[0]
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null
    return { lat: hit.latitude, lon: hit.longitude, label: hit.name }
  } catch (err) {
    console.warn('[geo/trails] open-meteo geocode failed', err instanceof Error ? err.message : err)
    return null
  }
}

/** Nominatim en dernier recours (mondial, adresses) — UA identifiant requis. */
async function geocodeNominatim(location: string): Promise<{ lat: number; lon: number; label: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=jsonv2&limit=1&accept-language=fr`,
      { headers: { 'User-Agent': USER_AGENT }, redirect: 'error', signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const results = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>
    const hit = results?.[0]
    const lat = Number(hit?.lat)
    const lon = Number(hit?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null
    return { lat, lon, label: (hit?.display_name ?? location).slice(0, 120) }
  } catch (err) {
    console.warn('[geo/trails] nominatim geocode failed', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Overpass ─────────────────────────────────────────────────────────────────

async function queryOverpass(ql: string): Promise<OverpassPayload> {
  let lastError: unknown = null
  for (const instance of OVERPASS_INSTANCES) {
    try {
      const res = await fetch(instance, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(ql)}`,
        redirect: 'error',
        // 10 s × 2 instances ; le timeout client garde de la marge pour les
        // géocodeurs exécutés avant la recherche.
        signal: AbortSignal.timeout(10_000),
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
      const payload = JSON.parse(text) as OverpassPayload
      if (typeof payload.remark === 'string' && payload.remark.trim()) {
        lastError = new Error('overpass runtime error')
        continue
      }
      return payload
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

function memberSegments(rel: OverpassElement): {
  segments: Array<Array<[number, number]>>
  directionLocked: boolean[]
} {
  const segments: Array<Array<[number, number]>> = []
  const directionLocked: boolean[] = []
  for (const member of rel.members ?? []) {
    if (member.type !== 'way' || !Array.isArray(member.geometry)) continue
    const memberParts: Array<Array<[number, number]>> = []
    let current: Array<[number, number]> = []
    const flush = () => {
      if (current.length >= 2) memberParts.push(current)
      current = []
    }
    for (const point of member.geometry) {
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
        flush()
        continue
      }
      current.push([point.lat, point.lon])
    }
    flush()
    if (member.role === 'backward') {
      memberParts.reverse()
      for (const part of memberParts) part.reverse()
    }
    for (const part of memberParts) {
      segments.push(part)
      directionLocked.push(member.role === 'forward' || member.role === 'backward')
    }
  }
  return { segments, directionLocked }
}

/** Cache Cloudflare opaque : coordonnées et adresses ne figurent jamais en
 * clair dans l'URL interne de cache ni dans les journaux associés. */
async function cacheDigest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
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
  // Défaut 10 km — leçon terrain (19 juil., Viriville) : à 6 km une zone
  // rurale peut n'avoir AUCUNE relation balisée alors qu'il y en a 11 à 10 km.
  if (!Number.isFinite(n)) return 10
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
