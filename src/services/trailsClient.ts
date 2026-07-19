import { apiUrl } from './apiBase'
import { safeJson } from '../utils/safeJson'
import { getValidAccessToken } from './googleAuth'
import { fetchTrailGeometryDirect, searchTrailsDirect } from './trailsOsm'
import type { LatLon } from './gpx'

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
  segments: LatLon[][]
  simplified?: { toleranceM: number; sourcePointCount: number }
}

export type TrailsApiOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 'network' | 'quota' | 'not_found' | 'error' }

async function callTrailsApi(body: Record<string, unknown>): Promise<Response | null> {
  const googleToken = await getValidAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (googleToken) headers['x-google-token'] = googleToken

  const ctrl = new AbortController()
  // 45 s : le pire cas serveur légitime est 3 géocodeurs × 5 s + 3 instances
  // Overpass × 10 s = 45 s. À 30 s (valeur initiale), le premier test terrain
  // abandonnait des requêtes que le serveur aurait fini par servir.
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), 45_000)
  try {
    return await fetch(apiUrl('/api/geo/trails'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
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
  return { ok: true, data: (await safeJson(res as Response)) as TrailGeometry }
}
