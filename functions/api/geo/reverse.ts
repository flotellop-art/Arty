import type { Env } from '../../env'
import { checkAllowedUser } from '../_lib/checkAllowedUser'

// Reverse geocoding via Google Maps Geocoding API.
// Appelé depuis src/services/reverseGeocode.ts pour résoudre les coords GPS
// en nom de ville AVANT que le prompt n'arrive au modèle IA (sinon le modèle
// devine et se trompe — cf BUG de la 1.0.29, Arty hésitait entre Firminy et
// Saint-Chamond au lieu de donner une réponse ferme).

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Auth : seuls les users whitelistés peuvent utiliser la clé Google Maps
  // du owner (évite le relais anonyme, RÈGLE 6 / BUG 42 CRIT-4).
  const email = await checkAllowedUser(request, env)
  if (!email) return Response.json({ error: 'Not found' }, { status: 404 })

  if (!env.GOOGLE_MAPS_API_KEY) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { latitude?: unknown; longitude?: unknown }
  try {
    body = (await request.json()) as { latitude?: unknown; longitude?: unknown }
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const lat = typeof body.latitude === 'number' ? body.latitude : NaN
  const lng = typeof body.longitude === 'number' ? body.longitude : NaN
  if (
    !isFinite(lat) ||
    !isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)

  try {
    // result_type figé côté serveur (pas de passthrough attaquant).
    // BUG 7 : clé en header `X-Goog-Api-Key`, jamais dans l'URL.
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}` +
      `&language=fr` +
      `&result_type=street_address|locality|administrative_area_level_2`

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY },
    })
    if (!resp.ok) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const data = (await resp.json()) as {
      status?: string
      results?: Array<{
        formatted_address: string
        address_components: Array<{
          long_name: string
          short_name: string
          types: string[]
        }>
      }>
    }

    if (data.status !== 'OK' || !data.results?.length) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const result = data.results[0]
    const find = (type: string) =>
      result.address_components.find((c) => c.types.includes(type))

    return Response.json({
      city:
        find('locality')?.long_name ??
        find('postal_town')?.long_name ??
        find('sublocality')?.long_name ??
        null,
      county: find('administrative_area_level_2')?.long_name ?? null,
      countyCode: find('administrative_area_level_2')?.short_name ?? null,
      state: find('administrative_area_level_1')?.long_name ?? null,
      country: find('country')?.long_name ?? null,
      countryCode: find('country')?.short_name ?? null,
      postcode: find('postal_code')?.long_name ?? null,
      displayName: result.formatted_address,
    })
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 })
  } finally {
    clearTimeout(timer)
  }
}
