import { apiUrl } from './apiBase'
import { safeJson } from '../utils/safeJson'
import { getValidAccessToken } from './googleAuth'
import { fetchTrailGeometriesDirect, fetchTrailGeometryDirect, searchTrailsDirect } from './trailsOsm'
import type { LatLon } from './gpx'

const MAX_TRAILS_API_BYTES = 6 * 1024 * 1024

// Client partagé de /api/geo/trails — utilisé par les outils LLM
// (tools/trailTools.ts) ET par la page carte (/trail/:id). Extrait pour ne pas
// dupliquer la discipline d'auth : BUG 23 (toujours getValidAccessToken, qui
// rafraîchit le token expiré, jamais le token brut) + timeout systématique.

export interface TrailSummary {
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
}

export interface TrailSearchResult {
  center: { lat: number; lon: number; label: string }
  radiusKm: number
  kind: string
  routes: TrailSummary[]
  totalFound: number
  nearbyPathCount: number
}

export interface TrailGeometry {
  id: number
  name: string
  kind: string
  distanceKm: number
  /** Distance non arrondie au km près, utilisée pour les filtres de seuil. */
  distanceMeters: number
  /** Géométrie pleine résolution : source unique de la distance et du GPX. */
  sourceSegments: LatLon[][]
  /** true = rôle OSM forward/backward : ce segment ne peut pas être inversé. */
  sourceSegmentDirectionLocked: boolean[]
  /** Géométrie allégée uniquement pour le rendu de la carte. */
  displaySegments: LatLon[][]
  simplified?: { toleranceM: number; sourcePointCount: number; displayPointCount: number }
  integrity: { hasNestedRelations: boolean; unsupportedWayRoles: string[]; displaySafe: boolean }
  provenance: { provider: 'OpenStreetMap'; relationId: number; fetchedAt: number }
}

function validSegments(value: unknown): value is LatLon[][] {
  return Array.isArray(value) && value.length > 0 && value.every((segment) =>
    Array.isArray(segment) && segment.length >= 2 && segment.every((point) =>
      Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      point[0] >= -90 && point[0] <= 90 && point[1] >= -180 && point[1] <= 180
    )
  )
}

/** Frontière runtime du contrat geometry-v3 (réseau/cache/IndexedDB). */
export function isTrailGeometry(value: unknown): value is TrailGeometry {
  if (!value || typeof value !== 'object') return false
  const geometry = value as Partial<TrailGeometry>
  if (!Number.isSafeInteger(geometry.id) || (geometry.id ?? 0) <= 0) return false
  if (typeof geometry.name !== 'string' || typeof geometry.kind !== 'string') return false
  if (!Number.isFinite(geometry.distanceKm) || (geometry.distanceKm ?? -1) < 0) return false
  if (!Number.isFinite(geometry.distanceMeters) || (geometry.distanceMeters ?? -1) < 0) return false
  if (!validSegments(geometry.sourceSegments) || !validSegments(geometry.displaySegments)) return false
  if (!Array.isArray(geometry.sourceSegmentDirectionLocked) ||
    geometry.sourceSegmentDirectionLocked.length !== geometry.sourceSegments.length ||
    geometry.sourceSegmentDirectionLocked.some((locked) => typeof locked !== 'boolean')) return false
  const integrity = geometry.integrity
  if (!integrity || typeof integrity.hasNestedRelations !== 'boolean' || typeof integrity.displaySafe !== 'boolean' ||
    !Array.isArray(integrity.unsupportedWayRoles) ||
    integrity.unsupportedWayRoles.some((role) => typeof role !== 'string')) return false
  const provenance = geometry.provenance
  return !!provenance && provenance.provider === 'OpenStreetMap' && provenance.relationId === geometry.id &&
    Number.isFinite(provenance.fetchedAt) && provenance.fetchedAt > 0 && provenance.fetchedAt <= Date.now() + 5 * 60 * 1000
}

export type TrailsApiOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 'network' | 'quota' | 'not_found' | 'error' }

async function callTrailsApi(body: Record<string, unknown>, timeoutMs = 45_000): Promise<Response | null> {
  const googleToken = await getValidAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (googleToken) headers['x-google-token'] = googleToken

  const ctrl = new AbortController()
  // 45 s : le pire cas serveur légitime est 3 géocodeurs × 5 s + 3 instances
  // Overpass × 10 s = 45 s. À 30 s (valeur initiale), le premier test terrain
  // abandonnait des requêtes que le serveur aurait fini par servir.
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  try {
    const response = await fetch(apiUrl('/api/geo/trails'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    // Le délai couvre aussi le corps : un serveur qui envoie seulement ses
    // en-têtes ne peut pas bloquer indéfiniment le budget de vérification.
    const reader = response.body?.getReader()
    let raw = ''
    if (!reader) {
      raw = await response.text()
      if (new TextEncoder().encode(raw).byteLength > MAX_TRAILS_API_BYTES) return null
    } else {
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_TRAILS_API_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(value)
      }
      const merged = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
      }
      raw = new TextDecoder().decode(merged)
    }
    const responseHeaders = new Headers(response.headers)
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
    return new Response(raw, { status: response.status, statusText: response.statusText, headers: responseHeaders })
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

async function classify(res: Response | null): Promise<'network' | 'quota' | 'not_found' | 'error' | 'ok'> {
  if (!res) return 'network'
  if (res.status === 429) return 'quota'
  if (res.status === 404) {
    // Le 404 est ambigu : « Lieu/Circuit introuvable » (métier) vs le 404
    // uniforme d'auth (notFoundResponse). Sans distinction, un hoquet de
    // vérification de token s'affichait comme « lieu introuvable » (constaté
    // au premier test terrain) — trompeur pour le modèle ET l'utilisateur.
    try {
      const body = (await res.clone().json()) as { error?: string }
      return body.error === 'Lieu introuvable' || body.error === 'Circuit introuvable'
        ? 'not_found'
        : 'error'
    } catch {
      return 'error'
    }
  }
  if (!res.ok) return 'error'
  return 'ok'
}

// Façade DIRECT d'abord, serveur en repli (fix terrain 19 juil., 19:52) :
// l'egress Cloudflare partagé est filtré par les services OSM communautaires
// → le pipeline client (trailsOsm.ts, IP de l'utilisateur, CORS ouvert) est
// devenu le chemin primaire — même architecture que les tuiles de la carte.
// Le serveur (cache 24 h) ne sert plus que de repli quand le réseau local de
// l'utilisateur bloque ces hosts. Un résultat DÉFINITIF du direct (lieu ou
// circuit introuvable) ne déclenche PAS le repli : le serveur interroge les
// mêmes sources, retenter coûterait jusqu'à 45 s pour la même réponse.

export async function searchTrails(params: {
  location: string
  radiusKm?: unknown
  kind?: unknown
}): Promise<TrailsApiOutcome<TrailSearchResult>> {
  try {
    const direct = await searchTrailsDirect(params)
    if (direct) return direct
  } catch { /* pipeline direct indisponible → repli serveur */ }

  const res = await callTrailsApi({ action: 'search', ...params })
  const status = await classify(res)
  if (status !== 'ok') return { ok: false, status }
  return { ok: true, data: (await safeJson(res as Response)) as TrailSearchResult }
}

export async function fetchTrailGeometry(routeId: number): Promise<TrailsApiOutcome<TrailGeometry>> {
  try {
    const direct = await fetchTrailGeometryDirect(routeId)
    if (direct) return direct
  } catch { /* pipeline direct indisponible → repli serveur */ }

  const res = await callTrailsApi({ action: 'geometry', routeId })
  const status = await classify(res)
  if (status !== 'ok') return { ok: false, status }
  const data = await safeJson(res as Response)
  return isTrailGeometry(data) ? { ok: true, data } : { ok: false, status: 'error' }
}

export async function fetchTrailGeometries(routeIds: number[]): Promise<TrailsApiOutcome<TrailGeometry[]>> {
  const ids = [...new Set(routeIds)]
  if (ids.length === 0 || ids.length > 12 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return { ok: false, status: 'not_found' }
  }
  const trails: TrailGeometry[] = []
  const collectedIds = new Set<number>()
  const collect = (items: TrailGeometry[]) => {
    for (const trail of items) {
      if (!collectedIds.has(trail.id)) {
        collectedIds.add(trail.id)
        trails.push(trail)
      }
    }
  }
  let firstFailure: 'network' | 'quota' | 'error' | null = null
  // Budget global : les quatre lots ne doivent jamais cumuler plusieurs
  // minutes de timeouts communautaires. Les lots déjà vérifiés sont conservés.
  const deadline = Date.now() + 70_000
  // Lots réduits : une super-relation ne doit pas faire échouer les 11 autres
  // ni produire une réponse énorme dans la WebView.
  for (let i = 0; i < ids.length; i += 3) {
    const chunk = ids.slice(i, i + 3)
    const remainingForDirectBatch = deadline - Date.now()
    if (remainingForDirectBatch <= 0) {
      firstFailure ??= 'network'
      break
    }
    let direct: Awaited<ReturnType<typeof fetchTrailGeometriesDirect>> = null
    try {
      direct = await fetchTrailGeometriesDirect(chunk, Math.min(10_000, remainingForDirectBatch))
    } catch { /* repli serveur pour ce lot uniquement */ }
    if (direct?.ok) {
      collect(direct.data)
      continue
    }
    if (direct && !direct.ok) continue // lot joignable, aucune relation exploitable

    const remainingForBatch = deadline - Date.now()
    if (remainingForBatch <= 0) {
      firstFailure ??= 'network'
      break
    }
    const res = await callTrailsApi(
      { action: 'geometries', routeIds: chunk },
      Math.min(30_000, remainingForBatch)
    )
    const status = await classify(res)
    if (status === 'not_found') continue
    if (status !== 'ok') {
      firstFailure ??= status
      if (status === 'quota') continue
      // Si une relation énorme a fait échouer le lot, sauver séparément les
      // petites relations restantes dans le budget global.
      for (const routeId of chunk) {
        const remainingForOne = deadline - Date.now()
        if (remainingForOne <= 0) break
        let singleDirect: Awaited<ReturnType<typeof fetchTrailGeometryDirect>> = null
        try {
          singleDirect = await fetchTrailGeometryDirect(routeId, Math.min(5000, remainingForOne))
        } catch { /* repli serveur */ }
        if (singleDirect?.ok) {
          collect([singleDirect.data])
          continue
        }
        if (singleDirect && !singleDirect.ok) continue
        const remainingAfterDirect = deadline - Date.now()
        if (remainingAfterDirect <= 0) break
        const singleRes = await callTrailsApi(
          { action: 'geometry', routeId },
          Math.min(20_000, remainingAfterDirect)
        )
        const singleStatus = await classify(singleRes)
        if (singleStatus !== 'ok') continue
        const single = await safeJson(singleRes as Response)
        if (isTrailGeometry(single)) collect([single])
        else firstFailure ??= 'error'
      }
      continue
    }
    const body = (await safeJson(res as Response)) as { trails?: unknown[] }
    if (Array.isArray(body.trails)) {
      const valid = body.trails.filter(isTrailGeometry)
      collect(valid)
      if (valid.length !== body.trails.length) firstFailure ??= 'error'
    } else {
      firstFailure ??= 'error'
    }
  }
  if (trails.length > 0 || firstFailure === null) return { ok: true, data: trails }
  return { ok: false, status: firstFailure }
}
