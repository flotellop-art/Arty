// ─────────────────────────────────────────────────────────────────────────────
// Intentions localisation / carte / météo — source unique (refonte routage,
// étape 1). Avant : 3 regex maintenues à la main dans 3 fichiers
// (locationContext.LOCATION_QUERY_TRIGGERS, geminiClient.isMapQuery, regex
// météo de getGeminiThinkingBudget) qui divergeaient silencieusement — le
// mécanisme exact du BUG 56.
//
// ⚠️ Les portées restent VOLONTAIREMENT différentes — ne pas fusionner :
//  - isLocationQuery (LARGE)  : « faut-il injecter le contexte GPS ? » —
//    inclut météo, restaurants, « où suis-je »…
//  - isMapToolQuery  (ÉTROITE): « utiliser le tool google_maps au lieu de
//    google_search ? » — EXCLUT la météo : google_maps et google_search sont
//    mutuellement exclusifs chez Gemini (BUG 5) et la météo doit passer par
//    google_search.
//  - isWeatherQuery           : météo/prévisions — sert au budget thinking
//    Gemini (lookup factuel → réflexion coupée).
//
// Les prédicats sont composés de FRAGMENTS partagés (ci-dessous), pas d'une
// mega-regex : ajouter un phrasing dans un fragment le propage partout où ce
// fragment est utilisé. Chaque cas terrain raté (BUG 56) → ajouter le pattern
// ET un test dans intentPatterns.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

// Vocabulaire carte/lieu explicite — partagé large + étroite.
const MAP_CORE =
  "google\\s*maps|itinéraire|trajet|street\\s*view|restaurant|horaires?|ouvert(?:e)?|fermée?|adresse|coordonnées|GPS|plan\\s+(?:de|du)|carte"

// « où … » — la variante étroite ne matche pas « où je suis » (position de
// l'utilisateur = injection GPS, pas un calcul d'itinéraire google_maps).
const WHERE_NARROW = "où\\s+(?:se\\s+trouve|est|aller|trouver)"
const WHERE_BROAD = "où\\s+(?:se\\s+trouve|est|aller|trouver|je\\s+suis|suis[-\\s]je)|où\\s+suis[-\\s]je"

// Distance / durée de trajet — phrasings indirects FR/EN (BUG 56).
// La variante large accepte aussi « combien de km de X » (terminaison « de »
// seule) ; l'étroite exige un complément de trajet explicite.
const COMBIEN_TAIL_NARROW = "pour|jusqu|en\\s+voiture|d['’]aller|de\\s+route|de\\s+trajet"
const distanceFragment = (combienTail: string): string =>
  `combien\\s+(?:de\\s+)?(?:temps|km|kilomètres?|minutes?|heures?)\\s+(?:${combienTail})` +
  "|temps\\s+(?:qu['’]il\\s+)?(?:faut|pour)\\s+(?:pour\\s+)?aller" +
  "|aller\\s+(?:à|jusqu['’]?\\s*à|en)" +
  "|distance\\s+(?:entre|jusqu|pour|de)|à\\s+quelle\\s+distance" +
  "|how\\s+(?:far|long)\\s+(?:is|to|from)|driving\\s+(?:time|distance)"
const DISTANCE_NARROW = distanceFragment(COMBIEN_TAIL_NARROW) + "|directions?\\s+(?:to|from)"
const DISTANCE_BROAD = distanceFragment(COMBIEN_TAIL_NARROW + "|de")

// Météo — FR/EN.
const WEATHER =
  "météo|quel\\s+temps|prévisions?|pleuvoir|pluie|température|weather|forecast|rain|temperature"

// Large uniquement : proximité, position de l'utilisateur, déplacement depuis ici.
const PROXIMITY = "près\\s+de\\s+moi|autour\\s+de\\s+moi|le\\s+plus\\s+proche|near\\s+me|nearby|closest"
const SELF_LOCATION =
  "dans\\s+quelle\\s+ville|quelle\\s+ville\\s+je|ma\\s+(?:ville|position|localisation)|mes\\s+coordonnées" +
  "|localise[-\\s]moi|je\\s+suis\\s+(?:à|où)|je\\s+suis\\s+à\\s+combien" +
  "|where\\s+am\\s+i|my\\s+(?:location|city|town|position)|what\\s+(?:city|town)"
const MOVEMENT_BROAD =
  "partir\\s+d['’]?ici|pour\\s+rejoindre|pour\\s+me\\s+rendre\\s+(?:à|au|en)" +
  "|depuis\\s+(?:ici|ma\\s+position|chez\\s+moi)" +
  "|directions|route\\s+(?:to|from)|navigate\\s+to|on\\s+foot|from\\s+my\\s+location"

// Un seul gros alternatif par prédicat (coût d'un unique .test(), cf. M3
// audit perf) — mais composé, pas écrit à la main.
const LOCATION_REGEX = new RegExp(
  [MAP_CORE, WHERE_BROAD, DISTANCE_BROAD, WEATHER, PROXIMITY, SELF_LOCATION, MOVEMENT_BROAD].join('|'),
  'i'
)
const MAP_TOOL_REGEX = new RegExp([MAP_CORE, WHERE_NARROW, DISTANCE_NARROW].join('|'), 'i')
const WEATHER_REGEX = new RegExp(WEATHER, 'i')

/** LARGE — la requête justifie-t-elle d'injecter le contexte GPS ? (ex-LOCATION_QUERY_TRIGGERS) */
export function isLocationQuery(message: string): boolean {
  if (!message) return false
  return LOCATION_REGEX.test(message)
}

/** ÉTROITE — utiliser le tool google_maps (exclusif de google_search, BUG 5) ? (ex-isMapQuery) */
export function isMapToolQuery(message: string): boolean {
  if (!message) return false
  return MAP_TOOL_REGEX.test(message)
}

/** Météo/prévisions — lookup factuel (budget thinking Gemini coupé). */
export function isWeatherQuery(message: string): boolean {
  if (!message) return false
  return WEATHER_REGEX.test(message)
}
