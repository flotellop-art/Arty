import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'

// Reverse geocoding via le proxy serveur /api/geo/reverse (Google Maps
// Geocoding API). Injecté dans le system prompt par buildLocationContext()
// pour que le modèle reçoive la ville résolue au lieu de deviner à partir
// des coords brutes.

export interface ReverseGeocodeResult {
  city: string | null
  county: string | null
  countyCode: string | null
  state: string | null
  country: string | null
  countryCode: string | null
  postcode: string | null
  displayName: string | null
}

// Cache in-memory par coords arrondies à 3 décimales (~110m). Les villes
// bougent pas ; si le user se déplace de <110m il reste dans la même ville.
const cache = new Map<string, { at: number; result: ReverseGeocodeResult }>()
const TTL_MS = 60 * 60 * 1000 // 1h

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result

  const token = await getValidAccessToken()
  // Pas de return null si token absent — on envoie quand même pour que la
  // requête apparaisse dans les logs Cloudflare. Le serveur renverra un 404
  // via checkAllowedUser() s'il n'y a pas de token valide. Sans ça (comme
  // en 1.0.31), un guard silencieux côté client rendait impossible le
  // diagnostic : on ne voyait AUCUNE trace dans Real-time Logs, laissant
  // penser que le proxy n'était pas déployé.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3500)

  try {
    const resp = await fetch(apiUrl('/api/geo/reverse'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-google-token': token } : {}),
      },
      body: JSON.stringify({ latitude: lat, longitude: lng }),
      signal: controller.signal,
    })
    if (!resp.ok) return null
    const result = (await resp.json()) as ReverseGeocodeResult
    cache.set(key, { at: Date.now(), result })
    return result
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
