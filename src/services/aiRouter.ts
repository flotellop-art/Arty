// AI Router — decides which model to use based on the query

const GEMINI_TRIGGERS = [
  // YouTube
  /youtube|youtubeur|youtubeuse|chaîne\s+(de|du|d')|vidéo[s]?\s+(de|du|d')|dernières\s+vidéos|résumé.*vidéo/i,
  // Google Maps / lieux / restaurants / avis
  /google\s*maps|itinéraire|trajet\s+(vers|de|entre)|temps\s+de\s+(route|trajet)|street\s*view|restaurant[s]?\s+(à|près|autour)|avis\s+(sur|google|client)/i,
  // Actualités temps réel
  /résultats?\s+(du|de)\s+(match|élection|vote)|score\s+(du|de)|classement\s+(ligue|championnat)|actu(alité)?s?\s+(du jour|récentes?)/i,
  // Contenus web spécifiques
  /résumé\s+(du|de\s+l[a'])\s+(site|page|article|blog)\s/i,
  // URLs directes
  /https?:\/\//i,
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
