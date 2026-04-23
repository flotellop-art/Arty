import { getUserLocation } from './native/location'

export const LOCATION_QUERY_TRIGGERS = /google\s*maps|itinéraire|trajet|street\s*view|restaurant|horaires?|adresse|où\s+(se\s+trouve|est|aller|trouver|je\s+suis|suis[-\s]je)|où\s+suis[-\s]je|coordonnées|GPS|plan\s+(de|du)|carte|météo|quel\s+temps|prévisions?|pleuvoir|pluie|température|près\s+de\s+moi|autour\s+de\s+moi|le\s+plus\s+proche|dans\s+quelle\s+ville|quelle\s+ville\s+je|ma\s+(ville|position|localisation)|mes\s+coordonnées|localise[-\s]moi|directions|route\s+(to|from)|weather|forecast|rain|temperature|near\s+me|nearby|closest|where\s+am\s+i|my\s+(location|city|town|position)|what\s+(city|town)/i

export async function buildLocationContext(message: string): Promise<string> {
  if (!LOCATION_QUERY_TRIGGERS.test(message)) return ''
  const pos = await getUserLocation()
  if (!pos) return ''
  return `\n\nPosition actuelle de l'utilisateur : latitude ${pos.latitude.toFixed(5)}, longitude ${pos.longitude.toFixed(5)} (précision ~${Math.round(pos.accuracy)}m). Utilise ces coordonnées pour répondre à toute question de localisation (ville actuelle, proximité, itinéraire, météo locale).`
}
