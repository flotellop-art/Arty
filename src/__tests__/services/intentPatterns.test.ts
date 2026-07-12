// Refonte routage (étape 1) — prédicats localisation/carte/météo consolidés.
// Ces tests prouvent l'ISO-COUVERTURE avec les 3 regex historiques
// (locationContext.LOCATION_QUERY_TRIGGERS, geminiClient.isMapQuery, regex
// météo de getGeminiThinkingBudget) et verrouillent la règle du BUG 56 :
// chaque phrasing indirect remonté du terrain a son cas ici.
import { describe, expect, it } from 'vitest'
import { isLocationQuery, isMapToolQuery, isWeatherQuery } from '../../services/router/intentPatterns'

describe('isLocationQuery (large — injection GPS)', () => {
  const positives = [
    // Carte / lieux explicites
    'ouvre google maps', "quel est l'itinéraire pour Lyon", 'le trajet dure combien',
    'montre le street view', 'un restaurant sympa', 'les horaires de la poste',
    'est-ce ouvert aujourd’hui ?', 'la pharmacie est fermée',
    "l'adresse de la mairie", 'mes coordonnées GPS', 'le plan du quartier', 'sur la carte',
    // Météo (FR/EN)
    'quelle météo demain', 'quel temps fera-t-il', 'les prévisions du week-end',
    'il va pleuvoir ?', 'la pluie arrive quand', 'quelle température dehors',
    'weather tomorrow', 'the forecast for Paris', 'will it rain', 'what temperature is it',
    // Position de l'utilisateur
    'où je suis ?', 'où suis-je', 'dans quelle ville je me trouve', 'ma position actuelle',
    'localise-moi', 'je suis à combien de km de Grenoble', 'where am i', 'my location please',
    'what city is this',
    // Distance / trajet — phrasings indirects (BUG 56, remontés terrain)
    'combien de temps pour aller à Voiron', "temps qu'il faut pour aller au travail",
    'à quelle distance se trouve Lyon', 'distance entre Voiron et Grenoble',
    'combien de km de Paris', 'aller à la gare', "partir d'ici pour Lyon",
    'pour rejoindre le centre', 'pour me rendre à Chambéry', 'depuis chez moi',
    'how far is the station', 'driving time to Geneva', 'directions from here',
    'navigate to the airport', 'on foot from my location', 'route to Annecy',
    // Proximité
    'boulangerie près de moi', 'autour de moi', 'le plus proche', 'pharmacy near me',
    'nearby restaurants', 'closest gas station',
  ]
  it.each(positives)('matche « %s »', (msg) => {
    expect(isLocationQuery(msg)).toBe(true)
  })

  const negatives = ['bonjour ça va ?', 'résume ce texte', 'combien font 2+2', '']
  it.each(negatives)('ne matche pas « %s »', (msg) => {
    expect(isLocationQuery(msg)).toBe(false)
  })
})

describe('isMapToolQuery (étroite — tool google_maps)', () => {
  const positives = [
    "l'itinéraire pour Lyon", 'le trajet en voiture', 'un restaurant à Voiron',
    'est-ce ouvert ?', 'ce magasin est fermé',
    'combien de temps pour aller à Grenoble', "temps qu'il faut pour aller au bureau",
    'à quelle distance est Lyon', 'distance entre Paris et Lille',
    'où se trouve la mairie', 'how far is Geneva', 'driving distance to Turin',
    'directions to the station',
  ]
  it.each(positives)('matche « %s »', (msg) => {
    expect(isMapToolQuery(msg)).toBe(true)
  })

  // ⚠️ Anti-régression BUG 5 : la météo ne doit JAMAIS sélectionner
  // google_maps (google_maps et google_search sont mutuellement exclusifs
  // chez Gemini — la météo doit passer par google_search).
  const weatherMsgs = ['quel temps à Lyon', 'météo demain', 'il va pleuvoir ?', 'weather in Paris']
  it.each(weatherMsgs)('météo « %s » → PAS google_maps (BUG 5)', (msg) => {
    expect(isWeatherQuery(msg)).toBe(true)
    expect(isMapToolQuery(msg)).toBe(false)
  })

  // « où je suis » = position utilisateur (injection GPS), pas un calcul
  // d'itinéraire — hors du prédicat étroit, dans le large.
  it('« où je suis » → large oui, étroite non', () => {
    expect(isLocationQuery('où je suis ?')).toBe(true)
    expect(isMapToolQuery('où je suis ?')).toBe(false)
  })

  it('ne matche pas le small talk', () => {
    expect(isMapToolQuery('bonjour !')).toBe(false)
    expect(isMapToolQuery('')).toBe(false)
  })
})

describe('isWeatherQuery', () => {
  const positives = [
    'météo à Voiron', 'quel temps demain', 'prévisions de la semaine', 'il va pleuvoir',
    'la pluie est prévue ?', 'quelle température', 'weather today', 'forecast for tomorrow',
    'rain expected?', 'temperature outside',
  ]
  it.each(positives)('matche « %s »', (msg) => {
    expect(isWeatherQuery(msg)).toBe(true)
  })

  it('ne matche pas une question de trajet', () => {
    expect(isWeatherQuery('itinéraire pour Lyon')).toBe(false)
    expect(isWeatherQuery('')).toBe(false)
  })
})

// Cohérence structurelle : le prédicat étroit est un sous-ensemble du large —
// toute requête google_maps justifie l'injection GPS, jamais l'inverse.
describe('cohérence étroite ⊂ large', () => {
  const samples = [
    'itinéraire pour Lyon', 'combien de temps pour aller à Voiron', 'restaurant à Grenoble',
    'où se trouve la gare', 'est-ce ouvert', 'driving time to Geneva', 'directions to the airport',
  ]
  it.each(samples)('« %s » : isMapToolQuery ⇒ isLocationQuery', (msg) => {
    expect(isMapToolQuery(msg)).toBe(true)
    expect(isLocationQuery(msg)).toBe(true)
  })
})
