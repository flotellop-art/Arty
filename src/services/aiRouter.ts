import { getGeminiKey, getMistralKey } from './activeApiKey'
import { getSelectedModel } from './modelSelector'

// AI Router — decides which model to use based on the query

const GEMINI_TRIGGERS = [
  // FR
  /youtube|youtubeur|youtubeuse|chaîne\s+(de|du|d')|vidéo[s]?\s+(de|du|d')|dernières\s+vidéos|résumé.*vidéo/i,
  /google\s*maps|itinéraire|trajet\s+(vers|de|entre)|temps\s+de\s+(route|trajet)|street\s*view|restaurant[s]?\s+(à|près|autour)|avis\s+(sur|google|client)|horaires?\s+(de|du|d')|ouvert\s+(aujourd|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/i,
  /résultats?\s+(du|de)\s+(match|élection|vote)|score\s+(du|de)|classement\s+(ligue|championnat)|actu(alité)?s?\s+(du jour|récentes?)/i,
  /résumé\s+(du|de\s+l[a'])\s+(site|page|article|blog)\s/i,
  /https?:\/\//i,
  /météo|quel\s+temps|prévisions?\s+(météo|pour)|pleuvoi?r|pluie\s+(demain|cette|ce)|température/i,
  /concurrent[s]?\s+(à|près|dans|autour)|entreprise[s]?\s+(de|du|près)/i,
  /norme[s]?\s+(RE|RT|DTU|NF)|RE\s*20[2-3][0-9]|réglementation\s+(thermique|énergétique)|MaPrimeRénov|aide[s]?\s+(de l'état|gouvernement|anah|rénovation)/i,
  /prix\s+(de|du|chez)\s+.*(weber|parex|prb|punto|sika|mapei|point\s*p|gedimat|bigmat|cedeo)/i,
  /fournisseur[s]?\s+(de|d'|pour)|où\s+(acheter|trouver|commander)/i,
  // EN
  /youtube\s+(channel|video[s]?)|latest\s+videos?|video\s+summary/i,
  /google\s*maps|directions|route\s+(to|from)|travel\s+time|street\s*view|restaurants?\s+(near|around|nearby)|reviews?\s+(on|about|google)|opening\s+hours|open\s+(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
  /match\s+results?|election\s+results?|standings|sports?\s+(news|scores?)|latest\s+news/i,
  /summary\s+of\s+(the\s+)?(site|page|article|blog)/i,
  /weather|forecast|will\s+it\s+rain|is\s+it\s+raining|temperature|rain\s+(tomorrow|today)/i,
  /competitors?\s+(near|around|in)|companies?\s+(near|in|around)/i,
  /supplier[s]?\s+(of|for)|where\s+(to\s+)?(buy|find|order)/i,
]

const PRIVATE_DATA_TRIGGERS = [
  // FR
  /mes\s+(mails|emails|e-mails|courriers|messages)/i,
  /mes\s+(fichiers|documents|drive|dossiers)/i,
  /mes\s+(clients|contacts|chantiers|projets)/i,
  /mes\s+(factures|devis|contrats)/i,
  /mon\s+(agenda|calendrier|planning)/i,
  /emails?\s+(non\s+lus|reçus|envoyés|du jour|récents)/i,
  /boîte\s+(de\s+réception|mail)/i,
  /sur\s+drive|dans\s+drive|google\s+drive/i,
  // EN
  /my\s+(mail|mails|email|emails|e-mails|messages|inbox)/i,
  /my\s+(files|documents|docs|drive|folders)/i,
  /my\s+(clients|contacts|projects|jobs)/i,
  /my\s+(invoices|quotes|contracts)/i,
  /my\s+(calendar|agenda|schedule)/i,
  /unread\s+emails?|received\s+emails?|sent\s+emails?|recent\s+emails?|inbox/i,
  /in\s+drive|on\s+drive|google\s+drive/i,
]

const REPORT_TRIGGERS = [
  // FR
  /rapport\s+(sur|de|du|d')|fais[- ]moi\s+un\s+rapport/i,
  /analyse\s+(du|de|des|le|la)|fais[- ]moi\s+une\s+analyse/i,
  /étude\s+(de|du|sur)|fais[- ]moi\s+une\s+étude/i,
  /état\s+(du|de|des)\s+(marché|lieux|secteur)/i,
  /benchmark|comparatif\s+(de|des|du)/i,
  /tendance[s]?\s+(du|de|des|20)/i,
  // EN
  /report\s+(on|about|of)|make\s+(me\s+)?a\s+report|write\s+(me\s+)?a\s+report/i,
  /analysis\s+of|analyze\s+(the|my|this)|analyse\s+(the|my|this)/i,
  /study\s+(of|on|about)|case\s+study/i,
  /state\s+of\s+(the\s+)?(market|sector|industry)/i,
  /benchmark|comparison\s+(of|between)/i,
  /trend[s]?\s+(of|in|for|20)/i,
]

export type AIProvider = 'claude' | 'gemini' | 'mistral' | 'hybrid'

export function detectProvider(message: string): AIProvider {
  const selectedModel = getSelectedModel()

  // If user forced a specific model, use it
  if (selectedModel !== 'auto') {
    // Gemini has no tools — redirect private data to Claude
    // Claude and Mistral both have tools — respect user choice
    if (selectedModel === 'gemini') {
      const isPrivate = PRIVATE_DATA_TRIGGERS.some((r) => r.test(message))
      if (isPrivate) return 'claude'
    }
    return selectedModel
  }

  // Auto mode — intelligent routing
  const geminiKey = getGeminiKey()
  const mistralKey = getMistralKey()

  // Private data → always Claude (needs tools)
  const isPrivate = PRIVATE_DATA_TRIGGERS.some((r) => r.test(message))
  if (isPrivate) return 'claude'

  // Reports → hybrid (Gemini research + Claude writing) if Gemini available
  if (geminiKey) {
    for (const regex of REPORT_TRIGGERS) {
      if (regex.test(message)) return 'hybrid'
    }
  }

  // Web/Maps/YouTube triggers → Gemini if available
  if (geminiKey) {
    for (const regex of GEMINI_TRIGGERS) {
      if (regex.test(message)) return 'gemini'
    }
  }

  // Simple chat → Mistral if available (cheaper + EU)
  if (mistralKey) return 'mistral'

  // Default → Claude
  return 'claude'
}
