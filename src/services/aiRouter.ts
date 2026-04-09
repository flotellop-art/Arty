// AI Router — decides which model to use based on the query

const GEMINI_TRIGGERS = [
  // YouTube
  /youtube|youtubeur|youtubeuse|chaîne\s+(de|du|d')|vidéo[s]?\s+(de|du|d')|dernières\s+vidéos|résumé.*vidéo/i,
  // Google Maps / lieux / restaurants / avis / horaires
  /google\s*maps|itinéraire|trajet\s+(vers|de|entre)|temps\s+de\s+(route|trajet)|street\s*view|restaurant[s]?\s+(à|près|autour)|avis\s+(sur|google|client)|horaires?\s+(de|du|d')|ouvert\s+(aujourd|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/i,
  // Actualités temps réel
  /résultats?\s+(du|de)\s+(match|élection|vote)|score\s+(du|de)|classement\s+(ligue|championnat)|actu(alité)?s?\s+(du jour|récentes?)/i,
  // Contenus web spécifiques
  /résumé\s+(du|de\s+l[a'])\s+(site|page|article|blog)\s/i,
  // URLs directes
  /https?:\/\//i,
  // Météo
  /météo|quel\s+temps|prévisions?\s+(météo|pour)|pleuvoi?r|pluie\s+(demain|cette|ce)|température/i,
  // Concurrence / recherche entreprises
  /concurrent[s]?|façadier[s]?\s+(à|près|dans|autour)|entreprise[s]?\s+(de|du)\s+(ravalement|façade)|qui\s+fait\s+(du\s+)?ravalement/i,
  // Normes / réglementations à jour
  /norme[s]?\s+(RE|RT|DTU|NF)|RE\s*20[2-3][0-9]|réglementation\s+(thermique|énergétique)|MaPrimeRénov|aide[s]?\s+(de l'état|gouvernement|anah|rénovation)/i,
  // Prix fournisseurs / comparatifs web
  /prix\s+(de|du|chez)\s+.*(weber|parex|prb|punto|sika|mapei|point\s*p|gedimat|bigmat|cedeo)/i,
  // Recherche produit/fournisseur
  /fournisseur[s]?\s+(de|d'|pour)|où\s+(acheter|trouver|commander)/i,
]

export type AIProvider = 'claude' | 'gemini'

export function detectProvider(message: string): AIProvider {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!geminiKey) return 'claude' // Pas de clé Gemini → toujours Claude

  for (const regex of GEMINI_TRIGGERS) {
    if (regex.test(message)) return 'gemini'
  }

  return 'claude'
}
