import type { TrailGeometry, TrailSearchResult, TrailSummary } from './trailsClient'
import { simplifySegments } from '../../functions/api/_lib/simplify'
import { segmentsKmWithinRadius } from '../../functions/api/_lib/geoDistance'
import { polylineKm, type LatLon } from './gpx'

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline sentiers DIRECT côté client (fix terrain 19 juil., 19:52).
//
// Constat prod : l'endpoint serveur /api/geo/trails pend systématiquement sur
// ses fetch vers Overpass — les IP egress Cloudflare partagées sont filtrées
// par ces services communautaires (précédent avril 2026 : bans de plages
// cloud entières), alors que les mêmes instances répondent en 1-2 s depuis
// une IP résidentielle. Même architecture que les tuiles de la carte : le
// NAVIGATEUR de l'utilisateur interroge OSM directement (sa propre IP, CORS
// ouvert — overpass-turbo fonctionne entièrement en navigateur sur ces mêmes
// instances). Bénéfice structurel : un abuseur brûle SA propre IP, jamais
// l'infra partagée d'Arty. Le serveur (cache 24 h) reste en REPLI via la
// façade trailsClient.
//
// Ce module MIROITE les règles de functions/api/geo/trails.ts (QL numérique
// pur, clip out geom(bbox), tri équestre > local > longue distance, plafond
// 12 routes / 4000 points via Douglas-Peucker partagé). Toute évolution de
// l'un DOIT toucher l'autre — verrouillé par le test de parité
// trailsOsm.parity.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

const OVERPASS_INSTANCES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
]
const OVERPASS_HEDGE_DELAY_MS = 1200
const MAX_ROUTES = 12
const MAX_GEOMETRY_POINTS = 4000
const MAX_SAFE_DISPLAY_POINTS = 20_000
const MAX_UPSTREAM_BYTES = 5 * 1024 * 1024

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

// La v1 ne choisit pas arbitrairement entre branches optionnelles : les rôles
// alternative/excursion/approach/connection font rejeter la relation par la
// garde d'intégrité, sinon leur longueur gonflerait le circuit canonique.
const REVERSIBLE_WAY_ROLES = new Set(['', 'main'])

/** null = infra injoignable (→ la façade tentera le serveur) ;
 *  'not_found' = réponse définitive (géocodeurs joignables, lieu inconnu). */
export type DirectOutcome<T> = { ok: true; data: T } | { ok: false; status: 'not_found' } | null

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── Géocodage (mêmes sources et même ordre que le serveur) ───────────────────

interface Center { lat: number; lon: number; label: string }

async function geocodeDirect(location: string): Promise<{ center: Center | null; reachable: boolean }> {
  const coords = location.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/)
  if (coords) {
    const lat = Number(coords[1])
    const lon = Number(coords[2])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { center: null, reachable: true }
    }
    return { center: { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` }, reachable: true }
  }

  let reachable = false

  // 1) Géoplateforme / BAN — gouvernement français, CORS ouvert. L'ancien
  // api-adresse.data.gouv.fr est arrivé à extinction le 31 janvier 2026.
  try {
    const res = await fetchWithTimeout(
      `https://data.geopf.fr/geocodage/search/?q=${encodeURIComponent(location)}&limit=1`,
      {}, 4000
    )
    if (res.ok) {
      reachable = true
      const geo = (await res.json()) as {
        features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { label?: string; score?: number } }>
      }
      const hit = geo.features?.[0]
      const lon = hit?.geometry?.coordinates?.[0]
      const lat = hit?.geometry?.coordinates?.[1]
      if ((hit?.properties?.score ?? 0) >= 0.4 && Number.isFinite(lat) && Number.isFinite(lon)) {
        return { center: { lat: lat as number, lon: lon as number, label: (hit?.properties?.label ?? location).slice(0, 120) }, reachable: true }
      }
    }
  } catch { /* injoignable → suivant */ }

  // 2) open-meteo (mondial).
  try {
    const res = await fetchWithTimeout(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=fr`,
      {}, 4000
    )
    if (res.ok) {
      reachable = true
      const geo = (await res.json()) as { results?: Array<{ latitude: number; longitude: number; name: string }> }
      const hit = geo.results?.[0]
      if (hit && Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)) {
        return { center: { lat: hit.latitude, lon: hit.longitude, label: hit.name }, reachable: true }
      }
    }
  } catch { /* injoignable → suivant */ }

  // 3) Nominatim en dernier recours (adresses mondiales).
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=jsonv2&limit=1&accept-language=fr`,
      {}, 4000
    )
    if (res.ok) {
      reachable = true
      const results = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>
      const hit = results?.[0]
      const lat = Number(hit?.lat)
      const lon = Number(hit?.lon)
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { center: { lat, lon, label: (hit?.display_name ?? location).slice(0, 120) }, reachable: true }
      }
    }
  } catch { /* injoignable */ }

  return { center: null, reachable }
}

// ── Overpass ─────────────────────────────────────────────────────────────────

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) {
    const raw = await res.text()
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error('overpass response too large')
    return raw
  }
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

async function queryOverpassDirect(ql: string, timeoutMs = 10_000): Promise<OverpassPayload | null> {
  // Une deadline séquentielle de 5 s laissait le premier miroir lent consommer
  // tout le budget : le second n'était alors jamais appelé. On lance donc un
  // hedge retardé (pas un doublon systématique) et on garde la première réponse
  // valide. Le budget reste global et le perdant est annulé immédiatement.
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('Timeout', 'AbortError')),
    timeoutMs
  )
  try {
    const attempts = OVERPASS_INSTANCES.map(async (instance, index) => {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, index * OVERPASS_HEDGE_DELAY_MS))
        if (controller.signal.aborted) throw controller.signal.reason
      }
      const res = await fetch(instance, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(ql)}`,
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`overpass ${res.status}`)
      const declaredSize = Number(res.headers.get('content-length') ?? 0)
      if (declaredSize > MAX_UPSTREAM_BYTES) throw new Error('overpass response too large')
      const raw = await readBounded(res, MAX_UPSTREAM_BYTES)
      const payload = JSON.parse(raw) as OverpassPayload
      // Overpass encode certaines erreurs d'exécution dans un JSON HTTP 200.
      // Ce n'est jamais un vrai « zéro résultat » : attendre l'autre miroir.
      if (typeof payload.remark === 'string' && payload.remark.trim()) {
        throw new Error('overpass runtime error')
      }
      return payload
    })
    const payload = await new Promise<OverpassPayload>((resolve, reject) => {
      let failed = 0
      for (const attempt of attempts) {
        attempt.then(resolve, () => {
          failed++
          if (failed === attempts.length) reject(new Error('overpass unavailable'))
        })
      }
    })
    controller.abort()
    return payload
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ── Parse partagé recherche (miroir du serveur — test de parité) ─────────────

export function parseSearchElements(
  elements: OverpassElement[],
  area?: { center: { lat: number; lon: number }; radiusM: number }
): {
  routes: TrailSummary[]
  nearbyPathCount: number
} {
  const routes: TrailSummary[] = []
  let nearbyPathCount = 0
  for (const el of elements) {
    if (el.type === 'count') {
      nearbyPathCount = Number(el.tags?.total ?? el.tags?.ways ?? 0) || 0
      continue
    }
    if (el.type !== 'relation') continue
    const tags = el.tags ?? {}
    const { segments } = memberSegments(el)
    const km = area
      ? segmentsKmWithinRadius(segments, area.center, area.radiusM)
      : segments.reduce((sum, seg) => sum + polylineKm(seg), 0)
    if (km < 0.05) continue
    const network = tags.network ?? null
    routes.push({
      id: el.id,
      name: routeLabel(tags, el.id),
      kind: tags.route ?? 'hiking',
      network,
      longDistance: /^(iwn|nwn|rwn|icn|ncn|rcn)$/.test(network ?? ''),
      distanceKm: Math.round(km * 10) / 10,
      colour: tags.colour ?? null,
      symbol: tags['osmc:symbol'] ?? null,
      website: tags.website ?? null,
      note: tags.description ?? tags.note ?? null,
    })
  }
  const groupOf = (r: TrailSummary) => (r.kind === 'horse' ? 0 : r.longDistance ? 2 : 1)
  routes.sort((a, b) => groupOf(a) - groupOf(b) || a.distanceKm - b.distanceKm)
  return { routes, nearbyPathCount }
}

function memberSegments(rel: OverpassElement): { segments: LatLon[][]; directionLocked: boolean[] } {
  const segments: LatLon[][] = []
  const directionLocked: boolean[] = []
  for (const member of rel.members ?? []) {
    if (member.type !== 'way' || !Array.isArray(member.geometry)) continue
    const memberParts: LatLon[][] = []
    let current: LatLon[] = []
    const flush = () => {
      if (current.length >= 2) memberParts.push(current)
      current = []
    }
    for (const point of member.geometry) {
      // `out geom(bbox)` représente les portions hors cadre par des valeurs
      // absentes/nulles. Les filtrer puis recoller les points restants créait
      // une diagonale fictive lorsqu'un way sortait puis rentrait dans la zone.
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

function routeLabel(tags: Record<string, string>, id: number): string {
  if (tags.name) return tags.name
  if (tags.from && tags.to) return `${tags.from} → ${tags.to}`
  if (tags.ref) return `Circuit ${tags.ref}`
  const colour = tags.colour ? ` (balisage ${tags.colour})` : ''
  return `Segment balisé${colour} #${id}`
}

function clampRadius(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 10
  return Math.min(15, Math.max(1, Math.round(n)))
}

// ── API publique du pipeline direct ──────────────────────────────────────────

export async function searchTrailsDirect(params: {
  location: string
  radiusKm?: unknown
  kind?: unknown
}): Promise<DirectOutcome<TrailSearchResult>> {
  const location = params.location.trim()
  if (!location || location.length > 120) return { ok: false, status: 'not_found' }
  const radiusKm = clampRadius(params.radiusKm)
  const kind = typeof params.kind === 'string' && KIND_FILTERS[params.kind] ? params.kind : 'all'

  const { center, reachable } = await geocodeDirect(location)
  if (!center) {
    // Géocodeurs joignables mais lieu inconnu = réponse définitive ; sinon on
    // laisse la façade tenter le serveur (réseau local peut-être filtrant).
    return reachable ? { ok: false, status: 'not_found' } : null
  }

  const radiusM = Math.round(radiusKm * 1000)
  const pad = (radiusM + 500) / 111_320
  const south = (center.lat - pad).toFixed(6)
  const north = (center.lat + pad).toFixed(6)
  const lonPad = pad / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180))
  const west = (center.lon - lonPad).toFixed(6)
  const east = (center.lon + lonPad).toFixed(6)

  const ql =
    `[out:json][timeout:8];` +
    `relation["type"="route"]["route"~"${KIND_FILTERS[kind]}"](around:${radiusM},${center.lat.toFixed(6)},${center.lon.toFixed(6)});` +
    `out geom(${south},${west},${north},${east}) 40;` +
    `way["highway"~"^(track|path|bridleway)$"](around:3000,${center.lat.toFixed(6)},${center.lon.toFixed(6)});` +
    `out count;`

  const data = await queryOverpassDirect(ql)
  if (!data) return null

  const { routes, nearbyPathCount } = parseSearchElements(
    data.elements ?? [],
    { center, radiusM }
  )
  return {
    ok: true,
    data: {
      center,
      radiusKm,
      kind,
      routes: routes.slice(0, MAX_ROUTES),
      totalFound: routes.length,
      nearbyPathCount,
    },
  }
}

export async function fetchTrailGeometryDirect(
  routeId: number,
  timeoutMs = 10_000
): Promise<DirectOutcome<TrailGeometry>> {
  if (!Number.isInteger(routeId) || routeId <= 0) return { ok: false, status: 'not_found' }

  const data = await queryOverpassDirect(`[out:json][timeout:8];relation(id:${routeId});out geom;`, timeoutMs)
  if (!data) return null

  const rel = (data.elements ?? []).find((e) => e.type === 'relation' && e.id === routeId)
  if (!rel) return { ok: false, status: 'not_found' }

  const geometry = geometryFromRelation(rel)
  return geometry.sourceSegments.length > 0
    ? { ok: true, data: geometry }
    : { ok: false, status: 'not_found' }
}

function geometryFromRelation(rel: OverpassElement): TrailGeometry {
  const tags = rel.tags ?? {}
  const { segments: sourceSegments, directionLocked: sourceSegmentDirectionLocked } = memberSegments(rel)
  const sourcePointCount = sourceSegments.reduce((n, s) => n + s.length, 0)
  const exactDistanceKm = sourceSegments.reduce((sum, s) => sum + polylineKm(s), 0)
  const distanceMeters = Math.round(exactDistanceKm * 1000)
  const distanceKm = Math.round(exactDistanceKm * 10) / 10
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
    provenance: { provider: 'OpenStreetMap', relationId: rel.id, fetchedAt: Date.now() },
  }
}

/** Vérifie plusieurs relations en une seule requête Overpass. Cela évite de
 * transformer une recherche de 12 candidats en 12 appels communautaires. */
export async function fetchTrailGeometriesDirect(
  routeIds: number[],
  timeoutMs = 10_000
): Promise<DirectOutcome<TrailGeometry[]>> {
  const ids = [...new Set(routeIds)]
  if (ids.length === 0 || ids.length > 3 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return { ok: false, status: 'not_found' }
  }
  const data = await queryOverpassDirect(`[out:json][timeout:8];relation(id:${ids.join(',')});out geom;`, timeoutMs)
  if (!data) return null
  const byId = new Map(
    (data.elements ?? [])
      .filter((element) => element.type === 'relation' && ids.includes(element.id))
      .map((element) => [element.id, geometryFromRelation(element)] as const)
  )
  const trails = ids.map((id) => byId.get(id)).filter((trail): trail is TrailGeometry => !!trail && trail.sourceSegments.length > 0)
  return trails.length > 0 ? { ok: true, data: trails } : { ok: false, status: 'not_found' }
}
