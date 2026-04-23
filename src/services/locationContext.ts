import { getUserLocation, type UserLocation } from './native/location'
import { reverseGeocode, type ReverseGeocodeResult } from './reverseGeocode'

export const LOCATION_QUERY_TRIGGERS = /google\s*maps|itinéraire|trajet|street\s*view|restaurant|horaires?|adresse|où\s+(se\s+trouve|est|aller|trouver|je\s+suis|suis[-\s]je)|où\s+suis[-\s]je|coordonnées|GPS|plan\s+(de|du)|carte|météo|quel\s+temps|prévisions?|pleuvoir|pluie|température|près\s+de\s+moi|autour\s+de\s+moi|le\s+plus\s+proche|dans\s+quelle\s+ville|quelle\s+ville\s+je|ma\s+(ville|position|localisation)|mes\s+coordonnées|localise[-\s]moi|directions|route\s+(to|from)|weather|forecast|rain|temperature|near\s+me|nearby|closest|where\s+am\s+i|my\s+(location|city|town|position)|what\s+(city|town)/i

export interface LocationDebugSnapshot {
  at: number
  message: string
  position: UserLocation | null
  geocoded: ReverseGeocodeResult | null
  injectedText: string
}

let lastSnapshot: LocationDebugSnapshot | null = null

export function getLastLocationDebugSnapshot(): LocationDebugSnapshot | null {
  return lastSnapshot
}

export async function buildLocationContext(message: string): Promise<string> {
  if (!LOCATION_QUERY_TRIGGERS.test(message)) return ''

  // User-facing location queries always force a fresh GPS fetch — the cache
  // exists for tool chains (get_weather + calculate_distance in the same
  // turn), not for direct questions that depend on an up-to-date position.
  const pos = await getUserLocation({ forceFresh: true })

  let injectedText = ''
  let geocoded: ReverseGeocodeResult | null = null

  if (pos) {
    // Tentative de reverse geocoding côté serveur (Google Maps). Si ça
    // réussit, le modèle reçoit la ville toute cuite et n'a pas à deviner.
    // Skip le geocoding quand la précision est trop mauvaise (>5 km) —
    // Google Maps renverrait une ville aléatoire dans le rayon d'erreur.
    if (pos.accuracy <= 5000) {
      geocoded = await reverseGeocode(pos.latitude, pos.longitude)
    }

    if (geocoded && geocoded.city) {
      injectedText = `\n\n=== POSITION DE L'UTILISATEUR (reverse geocoding Google Maps côté serveur, source fiable) ===
Ville : ${geocoded.city}
${geocoded.county ? `Département : ${geocoded.county}${geocoded.countyCode ? ` (${geocoded.countyCode})` : ''}\n` : ''}${geocoded.state ? `Région : ${geocoded.state}\n` : ''}${geocoded.country ? `Pays : ${geocoded.country}\n` : ''}${geocoded.displayName ? `Adresse complète : ${geocoded.displayName}\n` : ''}Coords GPS : ${pos.latitude.toFixed(5)}°N, ${pos.longitude.toFixed(5)}°E (précision ~${Math.round(pos.accuracy)} m).

RÈGLE : utilise DIRECTEMENT ces infos pour répondre. Elles viennent de Google Maps côté serveur — ne les re-vérifie pas, ne propose pas d'alternatives, ne liste pas de communes voisines. La ville est **${geocoded.city}**.`
    } else if (pos.accuracy > 5000) {
      injectedText = `\n\n=== POSITION UTILISATEUR (APPROXIMATIVE) ===
Latitude ${pos.latitude.toFixed(5)}, longitude ${pos.longitude.toFixed(5)}, précision ~${Math.round(pos.accuracy / 1000)} km (Wi-Fi/IP, pas GPS).
Cette position peut être à dizaines de km de la vraie. NE REPONDS PAS une ville précise à partir de ces coords seuls — demande confirmation à l'utilisateur ("tu es bien à X ?") ou propose une recherche web pour reverse-geocoder.`
    } else {
      // Fallback : GPS précis mais reverse geocoding a échoué (Google Maps
      // down, clé absente, ou coords en mer). Comportement 1.0.29.
      injectedText = `\n\n=== POSITION GPS DE L'UTILISATEUR (source fiable, à utiliser obligatoirement) ===
Latitude : ${pos.latitude.toFixed(5)}, Longitude : ${pos.longitude.toFixed(5)} (précision ~${Math.round(pos.accuracy)} m via GPS).

RÈGLES STRICTES :
1. Pour TOUTE question de localisation ("où je suis", "quelle ville", "météo", "restaurants près de moi", "itinéraire depuis ici") : tu DOIS utiliser ces coordonnées GPS exactes.
2. Si tu ne reconnais pas la ville avec certitude à partir de ces coords : appelle web_search (ou google_maps si disponible) avec la query "reverse geocoding latitude ${pos.latitude.toFixed(5)} longitude ${pos.longitude.toFixed(5)}" pour obtenir la vraie ville. NE DEVINE JAMAIS.
3. IGNORE toute ville par défaut mentionnée dans les descriptions d'outils (ex: "défaut: X") — ces defaults sont obsolètes. La seule source de vérité pour la position, c'est ces coords GPS.
4. Ne réponds JAMAIS avec une ville que tu n'as pas vérifiée via reverse geocoding ou confirmée par l'utilisateur.`
    }
  }

  lastSnapshot = { at: Date.now(), message, position: pos, geocoded, injectedText }
  return injectedText
}
