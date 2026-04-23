import { getGeminiKey, getMistralKey, getOpenAIKey } from './activeApiKey'
import { getSelectedModel, detectOpenAIIntent } from './modelSelector'

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
  // FR — mail / drive / clients / factures
  /mes\s+(mails|emails|e-mails|courriers|messages)/i,
  /mes\s+(fichiers|documents|drive|dossiers)/i,
  /mes\s+(clients|contacts|chantiers|projets)/i,
  /mes\s+(factures|devis|contrats)/i,
  /emails?\s+(non\s+lus|reçus|envoyés|du jour|récents)/i,
  /boîte\s+(de\s+réception|mail)/i,
  /sur\s+drive|dans\s+drive|google\s+drive/i,
  // FR — agenda / calendar (needs Calendar tools → Claude only)
  /mon\s+(agenda|calendrier|planning|emploi\s+du\s+temps)/i,
  /rendez[\s-]?vous|rdv\s+(du|de|avec|aujourd|demain|cette|la\s+semaine)/i,
  /(cr[ée]er?|ajoute[rz]?|planifie[rz]?|d[ée]place[rz]?|annule[rz]?|supprime[rz]?)\s+(un\s+)?(rdv|rendez[\s-]?vous|r[ée]union|meeting|\s*[ée]v[ée]nement)/i,
  /(prochaine?|prochain[ea]s?|cette)\s+(r[ée]union|meeting|journ[ée]e|semaine)\s+(dans\s+)?(mon\s+)?(agenda|calendrier)?/i,
  /qu['’]?\s*(y\s+a[\s-]?t[\s-]?il|ai[\s-]?je)\s+(de\s+pr[ée]vu|dans\s+(mon\s+)?(agenda|calendrier))/i,
  // FR — contacts (needs People API tools → Claude only)
  /(mes\s+)?contacts?\s+(google|de\s+)/i,
  /(trouve|cherche|recherche|ajoute|cr[ée]e)\s+(un\s+)?contact/i,
  /num[ée]ro\s+(de|du|de\s+t[ée]l[ée]phone\s+de)|t[ée]l[ée]phone\s+(de|du)\s+/i,
  /carnet\s+(d[’']?adresses?|de\s+contacts?)/i,
  // EN — mail / drive / clients
  /my\s+(mail|mails|email|emails|e-mails|messages|inbox)/i,
  /my\s+(files|documents|docs|drive|folders)/i,
  /my\s+(clients|projects|jobs)/i,
  /my\s+(invoices|quotes|contracts)/i,
  /unread\s+emails?|received\s+emails?|sent\s+emails?|recent\s+emails?|inbox/i,
  /in\s+drive|on\s+drive|google\s+drive/i,
  // EN — agenda / calendar
  /my\s+(calendar|agenda|schedule|appointments?)/i,
  /(create|add|schedule|move|cancel|delete)\s+(a\s+|an\s+)?(meeting|event|appointment)/i,
  /(upcoming|next|this\s+week['s]*)\s+(meetings?|events?|appointments?)/i,
  /what('?s|\s+is)\s+(on\s+|in\s+)?(my\s+)?(calendar|agenda|schedule)/i,
  // EN — contacts
  /my\s+contacts?\b/i,
  /(find|search|look\s+up|add|create)\s+(a\s+)?contact/i,
  /phone\s+number\s+of|address\s+book/i,
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

export type AIProvider = 'claude' | 'gemini' | 'mistral' | 'hybrid' | 'openai'

export interface ThinkingConfig {
  enabled: boolean
  budget: number
}

export function needsThinking(message: string): ThinkingConfig {
  if (REPORT_TRIGGERS.some((r) => r.test(message))) return { enabled: true, budget: 10000 }

  if (/\bdebug|\bbug\b|erreur|crash|refactor|architecture|conçois|implémente|\bcode\b|fonction\s+qui|stack\s*trace/i.test(message)) {
    return { enabled: true, budget: 10000 }
  }

  if (/analyse|compare|évalue|diagnostic|explique.*pourquoi|pourquoi\s+.*fonctionne|audit/i.test(message)) {
    return { enabled: true, budget: 3000 }
  }

  return { enabled: false, budget: 0 }
}

export function detectProvider(message: string): AIProvider {
  const selectedModel = getSelectedModel()

  // Private data → ALWAYS Claude (security rule — OpenAI/Gemini can't access tools/user data)
  const isPrivate = PRIVATE_DATA_TRIGGERS.some((r) => r.test(message))

  // If user forced a specific model, use it (but redirect private data to Claude for models without tools)
  if (selectedModel !== 'auto') {
    if (isPrivate && (selectedModel === 'gemini' || selectedModel === 'openai')) {
      return 'claude'
    }
    return selectedModel
  }

  // Auto mode — intelligent routing
  const geminiKey = getGeminiKey()
  const mistralKey = getMistralKey()
  const openaiKey = getOpenAIKey()

  // Private data → always Claude (needs tools + security)
  if (isPrivate) return 'claude'

  // Explicit OpenAI/ChatGPT mention → OpenAI (if key available)
  if (openaiKey && detectOpenAIIntent(message)) return 'openai'

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
