import { apiUrl } from './apiBase'
import { safeJson } from '../utils/safeJson'
import { getValidAccessToken } from './googleAuth'
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
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), 30_000)
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

function classify(res: Response | null): 'network' | 'quota' | 'not_found' | 'error' | 'ok' {
  if (!res) return 'network'
  if (res.status === 429) return 'quota'
  if (res.status === 404) return 'not_found'
  if (!res.ok) return 'error'
  return 'ok'
}

export async function searchTrails(params: {
  location: string
  radiusKm?: unknown
  kind?: unknown
}): Promise<TrailsApiOutcome<TrailSearchResult>> {
  const res = await callTrailsApi({ action: 'search', ...params })
  const status = classify(res)
  if (status !== 'ok') return { ok: false, status }
  return { ok: true, data: (await safeJson(res as Response)) as TrailSearchResult }
}

export async function fetchTrailGeometry(routeId: number): Promise<TrailsApiOutcome<TrailGeometry>> {
  const res = await callTrailsApi({ action: 'geometry', routeId })
  const status = classify(res)
  if (status !== 'ok') return { ok: false, status }
  return { ok: true, data: (await safeJson(res as Response)) as TrailGeometry }
}
