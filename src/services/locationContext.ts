import { getUserLocation, type UserLocation } from './native/location'
import { reverseGeocode, type ReverseGeocodeResult } from './reverseGeocode'

export const LOCATION_QUERY_TRIGGERS = /google\s*maps|itinéraire|trajet|street\s*view|restaurant|horaires?|adresse|où\s+(se\s+trouve|est|aller|trouver|je\s+suis|suis[-\s]je)|où\s+suis[-\s]je|coordonnées|GPS|plan\s+(de|du)|carte|météo|quel\s+temps|prévisions?|pleuvoir|pluie|température|près\s+de\s+moi|autour\s+de\s+moi|le\s+plus\s+proche|dans\s+quelle\s+ville|quelle\s+ville\s+je|ma\s+(ville|position|localisation)|mes\s+coordonnées|localise[-\s]moi|je\s+suis\s+(à|où)|combien\s+(de\s+)?(temps|km|kilomètres?|minutes?|heures?)\s+(pour|jusqu|en\s+voiture|d['’]aller|de\s+route|de\s+trajet|de)|temps\s+(qu['’]il\s+)?(faut|pour)\s+(pour\s+)?aller|aller\s+(à|jusqu['’]?\s*à|en)|distance\s+(entre|jusqu|pour|de)|à\s+quelle\s+distance|directions|route\s+(to|from)|weather|forecast|rain|temperature|near\s+me|nearby|closest|where\s+am\s+i|my\s+(location|city|town|position)|what\s+(city|town)|how\s+(far|long)\s+(is|to|from)|driving\s+(time|distance)/i

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
      // Ne pas dupliquer le code département si Google Maps renvoie
      // short_name === long_name (cas fréquent pour les départements
      // français : "Isère" / "Isère" au lieu de "Isère" / "38").
      const countyLine = geocoded.county
        ? `Département : ${geocoded.county}${
            geocoded.countyCode && geocoded.countyCode !== geocoded.county
              ? ` (${geocoded.countyCode})`
              : ''
          }\n`
        : ''

      injectedText = `\n\n=== POSITION DE L'UTILISATEUR (reverse geocoding Google Maps côté serveur, source fiable) ===
Ville : ${geocoded.city}
${countyLine}${geocoded.state ? `Région : ${geocoded.state}\n` : ''}${geocoded.country ? `Pays : ${geocoded.country}\n` : ''}${geocoded.displayName ? `Adresse complète : ${geocoded.displayName}\n` : ''}Coords GPS : ${pos.latitude.toFixed(5)}°N, ${pos.longitude.toFixed(5)}°E (précision ~${Math.round(pos.accuracy)} m).

RÈGLES ABSOLUES (ne jamais les enfreindre) :

1. La ville est **${geocoded.city}**. Cette info vient de Google Maps Geocoding API côté serveur — c'est une source fiable, PAS une estimation de ta part. Tu n'as ni deviné, ni inventé, ni tiré au hasard : on te fournit l'info directement.

2. Réponds DIRECTEMENT avec cette ville. Ne propose pas d'alternatives. Ne liste pas de communes voisines. Ne dis pas "probablement" ou "autour de".

3. Si l'utilisateur te challenge ("tu es sûr ?", "c'est vrai ?", "comment tu sais ?") : confirme fermement. Explique que la ville vient du GPS de son téléphone + reverse geocoding Google Maps côté serveur, pas d'une devinette. NE JAMAIS dire "j'ai sorti ce nom au hasard", "je ne sais pas", "c'est une erreur de ma part" ou t'excuser — ce serait un MENSONGE, car tu as reçu l'info dans ton contexte (ce bloc que tu es en train de lire).

4. Si l'utilisateur insiste en disant qu'il est ailleurs : tu peux lui faire confiance ET lui expliquer que selon le GPS il est à **${geocoded.city}**, peut-être que son GPS est imprécis ou qu'il est en déplacement. Mais ne nie jamais avoir reçu cette info.`
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
