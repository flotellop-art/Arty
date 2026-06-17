import type { Env } from '../../env'
import { checkAllowedUserPeek } from '../_lib/checkAllowedUser'
import {
  consumeOwnerApiQuota,
  ownerApiLimitResponse,
  planSubjectToOwnerApiCap,
} from '../_lib/freeQuota'

// Reverse geocoding via Google Maps Geocoding API.
// Appelé depuis src/services/reverseGeocode.ts pour résoudre les coords GPS
// en nom de ville AVANT que le prompt n'arrive au modèle IA (sinon le modèle
// devine et se trompe — cf BUG de la 1.0.29, Arty hésitait entre Firminy et
// Saint-Chamond au lieu de donner une réponse ferme).

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Auth : tout utilisateur Google authentifié (peek read-only — ne décrémente
  // pas le compteur trial, le geocoding n'est pas un message IA). Anti-relais
  // anonyme (RÈGLE 6 / BUG 42 CRIT-4). NB : les plans free/trial ont accès mais
  // sont PLAFONNÉS par email/jour ci-dessous (la clé Google Maps est payante) ;
  // les plans payants ne sont pas plafonnés. Le filet multi-comptes est le quota
  // journalier DUR côté Google Cloud (cf. docs ops).
  const allowed = await checkAllowedUserPeek(request, env)
  if (!allowed) return Response.json({ error: 'Not found' }, { status: 404 })

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

  // Cap journalier par email sur la clé Google Maps PAYANTE du owner — plans
  // non-payants uniquement. Après validation lat/lng (coords invalides = pas de
  // quota consommé). Un 429 est géré côté client comme un échec doux (fallback
  // coords brutes), pas un crash.
  if (planSubjectToOwnerApiCap(allowed.planType)) {
    const cap = await consumeOwnerApiQuota(env, allowed.email, 'geo-reverse')
    if (!cap.allowed) return ownerApiLimitResponse('geo-reverse', cap.limit)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)

  try {
    // BUG 7 : la règle générale est de passer les clés API en header pour
    // éviter qu'elles ne se retrouvent dans des logs d'URL. EXCEPTION pour
    // Google Maps Geocoding API : c'est une API legacy qui n'accepte que
    // le query param `?key=` (testé en 1.0.30, le header X-Goog-Api-Key
    // est ignoré → REQUEST_DENIED → fallback côté client). Mitigations :
    //   - appel server-to-server depuis un Worker Cloudflare (pas de CDN
    //     intermédiaire qui logge l'URL)
    //   - clé restreinte à Geocoding API uniquement côté Google Cloud
    //   - clé non exposée dans les logs Cloudflare Workers par défaut
    //
    // Pas de `result_type=...` : ce filtre rejetait des coords valides en
    // pleine campagne ou en bord de commune (Google renvoyait ZERO_RESULTS
    // car aucun résultat n'avait pile le type demandé). On laisse Google
    // retourner le résultat le plus précis dispo, on extrait la ville
    // depuis address_components qui contient toujours tous les niveaux.
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}` +
      `&language=fr` +
      `&key=${encodeURIComponent(env.GOOGLE_MAPS_API_KEY)}`

    const resp = await fetch(url, { signal: controller.signal })
    if (!resp.ok) {
      console.warn('[geo/reverse] Google Maps HTTP', resp.status)
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const data = (await resp.json()) as {
      status?: string
      error_message?: string
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
      // Log côté serveur uniquement (visible dans Cloudflare Workers logs).
      // Le client reçoit toujours 404 uniforme — aucune fuite vers l'attaquant.
      console.warn('[geo/reverse] Google Maps status', data.status, data.error_message ?? '')
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Premier résultat = le plus précis (street_address en général).
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
