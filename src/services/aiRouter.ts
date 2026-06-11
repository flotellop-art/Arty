import { getGeminiKey, getMistralKey, getOpenAIKey } from './activeApiKey'
import { getSelectedModel, detectOpenAIIntent } from './modelSelector'
import type { ReflectionLevel } from './reflectionLevel'

// AI Router — decides which model to use based on the query.
// Routage en mode auto: Gemini par défaut (google_search activé, gratuit)
// pour bénéficier de données à jour 2026+. Les exceptions sont:
// - PRIVATE_DATA_TRIGGERS → Claude (tools natifs Gmail/Drive/Calendar)
// - HYBRID_TRIGGERS → Hybrid (Gemini research + Claude synthesis)
// - TRIVIAL_CHAT_REGEX → Mistral/Claude (pas de search inutile)
// - euOnly conversations → forcé Mistral en amont (useConversation.ts)
// - fichiers attachés → forcé Claude en amont (useConversation.ts)

export const PRIVATE_DATA_TRIGGERS = [
  // FR — mail / drive / clients / factures
  /mes\s+(mails|emails|e-mails|courriers|messages)/i,
  /mes\s+(fichiers|documents|drive|dossiers)/i,
  /mes\s+(clients|contacts|projets)/i,
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
  // FR — Tasks / Notes / Reminders (étape 12 audit, BUG 56 extension)
  /mes\s+(rappels?|reminders?)|cr[ée]e[rz]?\s+un\s+rappel/i,
  /mes\s+(t[âa]ches?|tasks?)\s+(google|du|de)?/i,
  /mes\s+(notes?|keep)\s+(google)?/i,
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
  // EN — Tasks / Notes / Reminders (étape 12 audit)
  /my\s+(reminders?|tasks?|notes?)\b/i,
  /(create|add|set)\s+(a\s+)?(reminder|task|note)/i,
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

// Hybrid mode triggers — superset of REPORT_TRIGGERS plus comparison /
// regulation / pricing / how-to queries that benefit from Gemini research
// followed by Claude synthesis. REPORT_TRIGGERS reste utilisé par
// needsThinking() pour le palier 10000 (rapport stratégique uniquement).
const HYBRID_TRIGGERS = [
  ...REPORT_TRIGGERS,
  /\bvs\b|versus|\bcontre\b|compare[z]?\s+(.*)\s+(et|avec|à)/i,
  /norme[s]?\s+(RE|RT|DTU|NF)|réglementation\s+thermique|MaPrimeRénov/i,
  /prix\s+(des?|du|au)\s+m[²2]|coût\s+(des?|du)\s+travaux/i,
  /comment\s+(installer|configurer|mettre\s+en\s+place|créer\s+une?\s+entreprise)/i,
]

// Trivial chat — salutations, remerciements, calculs simples, suivis très
// courts. Ces messages n'ont pas besoin de recherche web (latence + tokens
// gaspillés) et restent sur le chemin rapide (Mistral/Haiku).
// Partagé entre detectProvider() et selectClaudeSubModel().
const TRIVIAL_CHAT_REGEX = /^(salut|bonjour|bonsoir|coucou|hello|hi|hey|yo|merci|thanks?|thx|ok|okay|d'accord|super|cool|parfait|nickel|top|génial|bien|bien sûr|ouais|oui|non|nope)\b|^(\s*[\d+\-*/().\s]+\s*=?\s*\?*\s*)$|^(combien\s+font?\s+\d|how\s+much\s+is\s+\d)/i

// URL detection — Mistral n'a pas de tool web_fetch natif, seulement
// web_search qui renvoie des SNIPPETS d'index, pas le contenu d'une page.
// Résultat : Mistral hallucine le contenu d'un article/vidéo dont on lui
// colle l'URL (citations inventées, sources [1][2][3] fictives). Claude
// (web_fetch natif Anthropic) et Gemini (url_context natif) lisent
// réellement la page. En mode auto, on route donc vers Claude dès qu'une
// URL est détectée. Les conversations euOnly restent forcées Mistral en
// amont (useConversation.ts) et un bandeau UrlPasteHint guide alors
// l'utilisateur à coller le texte plutôt que l'URL.
const URL_REGEX = /\bhttps?:\/\/[^\s<>"'`]+|\b(?:www\.)?(?:youtu\.be|youtube\.com)\/[^\s<>"'`]+/i

export function hasUrl(message: string): boolean {
  if (!message) return false
  return URL_REGEX.test(message)
}

// YouTube — détection + extraction. Gemini lit nativement une vidéo YouTube si
// on lui passe l'URL canonique `watch?v=ID` dans une part fileData (cf.
// geminiClient.ts). On normalise vers cette forme : l'API rejette parfois les
// liens courts youtu.be et les paramètres de tracking (?si=…). Les IDs vidéo
// font 11 caractères [A-Za-z0-9_-]. Deux regex (test non-global / extraction
// global) pour éviter le piège lastIndex stateful (cf. URL_REGEX ci-dessus).
const YOUTUBE_ID_REGEX = /(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
const YOUTUBE_ID_REGEX_GLOBAL = /(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/gi

export function hasYouTubeUrl(message: string): boolean {
  if (!message) return false
  return YOUTUBE_ID_REGEX.test(message)
}

/**
 * Extrait et normalise les URLs YouTube d'un message vers la forme canonique
 * `https://www.youtube.com/watch?v=ID` (dédupliquées). Utilisé par geminiClient
 * pour passer la vidéo à Gemini en part fileData.
 */
export function extractYouTubeUrls(message: string): string[] {
  if (!message) return []
  const out: string[] = []
  YOUTUBE_ID_REGEX_GLOBAL.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = YOUTUBE_ID_REGEX_GLOBAL.exec(message)) !== null) {
    if (m[1]) out.push(`https://www.youtube.com/watch?v=${m[1]}`)
  }
  return [...new Set(out)]
}

// Variante globale pour extraire TOUTES les URLs d'un message (URL_REGEX
// reste sans flag `g` car utilisée en .test() — un `g` rendrait .test()
// stateful via lastIndex).
const URL_REGEX_GLOBAL = /\bhttps?:\/\/[^\s<>"'`]+|\b(?:www\.)?(?:youtu\.be|youtube\.com)\/[^\s<>"'`]+/gi

/**
 * Extrait les URLs pointant vers un PDF public (`.pdf` dans le chemin).
 * Claude `web_fetch` et Gemini `url_context` ne lisent pas les PDF binaires —
 * ces URLs sont récupérées via Linkup /fetch (→ Markdown) puis injectées
 * dans le contexte. Scope V1 : extension `.pdf` uniquement (un PDF servi via
 * Content-Type sans extension n'est pas détectable côté client).
 */
export function extractPdfUrls(message: string): string[] {
  if (!message) return []
  const matches = message.match(URL_REGEX_GLOBAL)
  if (!matches) return []
  const out: string[] = []
  for (const raw of matches) {
    // Retire la ponctuation de fin que la regex peut happer (ex: "voir x.pdf.")
    const cleaned = raw.replace(/[).,;!?]+$/, '')
    try {
      const u = new URL(cleaned)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
      if (/\.pdf$/i.test(u.pathname)) out.push(cleaned)
    } catch {
      // Match non parseable (ex: www.youtube.com sans protocole) → ignoré.
    }
  }
  return [...new Set(out)]
}

// Lot C (audit Mistral, juin 2026) — toutes les URLs http(s) lisibles d'un
// message, pour le fetch Linkup des conversations euOnly (Mistral n'a aucune
// lecture d'URL native). Exclut les plateformes vidéo : Linkup n'en extrait
// pas le contenu (pas de transcript), autant laisser Mistral déclarer
// honnêtement la limite plutôt qu'injecter une page de garde inutile.
const VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com)$/i

export function extractWebUrls(message: string): string[] {
  if (!message) return []
  const matches = message.match(URL_REGEX_GLOBAL)
  if (!matches) return []
  const out: string[] = []
  for (const raw of matches) {
    const cleaned = raw.replace(/[).,;!?]+$/, '')
    try {
      const u = new URL(cleaned)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
      if (VIDEO_HOSTS.test(u.hostname)) continue
      out.push(cleaned)
    } catch {
      // Match non parseable → ignoré.
    }
  }
  return [...new Set(out)]
}

/**
 * Décide si une requête utilisateur doit déclencher une recherche web forcée.
 * Règle posée par l'utilisateur le 10 mai 2026 : recherche internet par défaut
 * sur la plupart des requêtes, SAUF :
 * - Données privées (mails, Drive, calendar, contacts) — BUG 12 : Gemini
 *   hallucine sur des données privées inaccessibles ; les tools natifs
 *   Gmail/Drive/Calendar récupèrent les vraies données, web search inutile.
 * - Salutations / micro-réponses (TRIVIAL_CHAT_REGEX) — gaspillage de tokens.
 *
 * Les fichiers attachés (PDF, image) ne désactivent PAS la recherche web :
 * l'utilisateur veut explicitement "analyser le fichier ET chercher sur
 * internet la réponse à la question" (cf. demande du 10 mai 2026).
 */
export function shouldUseWebSearch(message: string): boolean {
  if (!message || !message.trim()) return false
  if (PRIVATE_DATA_TRIGGERS.some((r) => r.test(message))) return false
  if (message.length < 150 && TRIVIAL_CHAT_REGEX.test(message)) return false
  return true
}

export type AIProvider = 'claude' | 'gemini' | 'mistral' | 'hybrid' | 'openai'

export interface ThinkingConfig {
  enabled: boolean
  budget: number
}

export function needsThinking(message: string): ThinkingConfig {
  // Tier 1 — strategic reports (highest budget)
  if (REPORT_TRIGGERS.some((r) => r.test(message))) return { enabled: true, budget: 10000 }
  if (/rapport\s+stratégique|business\s+plan|étude\s+de\s+marché/i.test(message)) {
    return { enabled: true, budget: 10000 }
  }

  // Tier 2 — debug / architecture / heavy code work
  if (/debug\b|crash|refactor|architecture|implémente\s+un\b|conçois\s+un\b|stack\s+trace/i.test(message)) {
    return { enabled: true, budget: 8000 }
  }

  // Tier 3 — analysis / comparison / code questions / purchase advice
  // Devis et conseils d'achat ont besoin d'une analyse multi-critères
  // (prix + qualité + adéquation usage), donc thinking activé pour
  // éviter les contradictions du genre "option 1 = meilleure affaire"
  // puis "évite l'option 1" dans le même fil.
  if (/\bcode\b|fonction\s+qui|analyse|compare|évalue|pourquoi.*fonctionne/i.test(message)) {
    return { enabled: true, budget: 3000 }
  }
  if (/devis|conseil[s]?\s+(d['']achat|achat)|quelle?\s+(option|choix|marque|alternative|formule)|que\s+(me\s+)?conseille[s\-]?\s*tu|recomman(de|der|dation)/i.test(message)) {
    return { enabled: true, budget: 3000 }
  }

  // Tier 4 — diagnostic / audit / explanations
  if (/diagnostic|audit\b|explique\s+pourquoi|qu'est-ce\s+qui\s+(cause|provoque|fait)/i.test(message)) {
    return { enabled: true, budget: 1500 }
  }

  return { enabled: false, budget: 0 }
}

// ── Réflexion : niveau utilisateur → directive API moderne ───────────────────
// L'API thinking d'Anthropic a changé : `thinking:{type:'enabled', budget_tokens}`
// est DÉPRÉCIÉ et renvoie 400 sur Opus 4.8/4.7. Le remplaçant est
// `thinking:{type:'adaptive'}` + `output_config:{effort}`. On traduit donc le
// niveau de réflexion choisi par l'utilisateur (reflectionLevel.ts) en un
// effort. `enabled`/`budget` sont conservés UNIQUEMENT pour la sélection de
// modèle (selectClaudeSubModel garde Opus pour les rapports à gros budget) —
// ils ne sont PAS envoyés à l'API.
//
// Niveaux d'effort valides : low/medium/high/max sur Opus 4.5→4.8 ET Sonnet 4.6.
// `xhigh` n'existe que sur Opus 4.7/4.8 → on l'évite pour rester compatible
// Sonnet. Haiku 4.5 ne supporte AUCUN effort (400) → le garde-fou est côté
// anthropicClient (n'envoie jamais d'effort si le modèle résolu est Haiku).
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'max'

export interface ClaudeThinkingDirective {
  enabled: boolean
  budget: number
  effort: ClaudeEffort | null
}

export function resolveClaudeThinking(
  message: string,
  level: ReflectionLevel,
  isPro: boolean
): ClaudeThinkingDirective {
  switch (level) {
    case 'rapide':
      // Réflexion coupée — réponse la plus rapide / la moins chère.
      return { enabled: false, budget: 0, effort: null }
    case 'approfondi':
      // Réflexion forcée élevée. budget ≥ 8000 garde la sélection cohérente
      // sans franchir le seuil Opus (10000 + regex rapport).
      return { enabled: true, budget: Math.max(needsThinking(message).budget, 8000), effort: 'high' }
    case 'max':
      // Réflexion maximale (Pro). Hors Pro (l'UI bloque déjà le tap), on
      // retombe sur « approfondi » plutôt que de facturer un effort premium.
      return isPro
        ? { enabled: true, budget: Math.max(needsThinking(message).budget, 10000), effort: 'max' }
        : { enabled: true, budget: Math.max(needsThinking(message).budget, 8000), effort: 'high' }
    case 'auto':
    default: {
      // Comportement historique : l'heuristique par message décide. On traduit
      // le budget en effort (l'API moderne ne prend plus budget_tokens).
      const t = needsThinking(message)
      if (!t.enabled) return { enabled: false, budget: 0, effort: null }
      const effort: ClaudeEffort = t.budget >= 8000 ? 'high' : t.budget >= 3000 ? 'medium' : 'low'
      return { enabled: true, budget: t.budget, effort }
    }
  }
}

export type ClaudeSubModel = 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' | 'claude-opus-4-8'

/**
 * Choisit la déclinaison de Claude la mieux adaptée à la requête :
 * - Free → Haiku TOUJOURS (le proxy refuse Sonnet/Opus pour ce plan)
 * - Haiku pour les messages courts/triviaux sans données privées ni thinking
 * - Opus pour les rapports stratégiques (Pro uniquement, thinking max)
 * - Sonnet par défaut
 */
export function selectClaudeSubModel(
  message: string,
  thinking: ThinkingConfig,
  isPrivateData: boolean,
  isPro: boolean
): ClaudeSubModel {
  // Plan free : Haiku uniquement, sans exception. Évite le 403 model_locked
  // serveur-side. Le plan est mis en cache par usePlanStatus dans
  // localStorage 'arty-plan-cache' à chaque /api/subscription/status.
  let cachedPlan: string | null = null
  try { cachedPlan = localStorage.getItem('arty-plan-cache') } catch {}
  if (cachedPlan === 'free') {
    return 'claude-haiku-4-5-20251001'
  }

  // Haiku — short, low-stakes queries (no private data, no thinking needed)
  const isShortTrivial = message.length < 150 && TRIVIAL_CHAT_REGEX.test(message)
  if (!isPrivateData && !thinking.enabled && isShortTrivial) {
    return 'claude-haiku-4-5-20251001'
  }

  // Opus — strategic deep-dive reports (Pro tier + max thinking budget)
  if (isPro && thinking.budget >= 10000 && /rapport\s+stratégique|business\s+plan|étude\s+de\s+marché/i.test(message)) {
    return 'claude-opus-4-8'
  }

  return 'claude-sonnet-4-6'
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

  // URL YouTube → Gemini : il lit la vidéo nativement (part fileData, cf.
  // geminiClient.ts). Sans clé Gemini, fallback Claude (qui ne lit pas la
  // vidéo non plus, mais c'est le comportement historique). Les AUTRES URL →
  // Claude (web_fetch natif Anthropic ; Mistral hallucine sur les URLs, cf.
  // commentaire URL_REGEX). La fiabilité du contenu prime sur l'intent ChatGPT.
  if (hasYouTubeUrl(message)) return geminiKey ? 'gemini' : 'claude'
  if (hasUrl(message)) return 'claude'

  // Explicit OpenAI/ChatGPT mention → OpenAI (if key available)
  if (openaiKey && detectOpenAIIntent(message)) return 'openai'

  // Reports / comparisons / regulation / pricing / how-to → hybrid
  // (Gemini research + Claude writing) if Gemini available
  if (geminiKey) {
    for (const regex of HYBRID_TRIGGERS) {
      if (regex.test(message)) return 'hybrid'
    }
  }

  // Trivial chat (salutations, merci, calculs, "ok") → fast path without
  // web search. Mistral if available (cheap + EU), sinon Claude (Haiku via
  // selectClaudeSubModel). Évite la latence/coût d'une recherche inutile.
  const isTrivial = message.length < 150 && TRIVIAL_CHAT_REGEX.test(message)
  if (isTrivial) {
    return mistralKey ? 'mistral' : 'claude'
  }

  // Default → Gemini avec google_search activé (gratuit + données 2026
  // à jour). Couvre toute question factuelle/générale au-delà de la
  // mémoire d'entraînement des modèles. Voir geminiClient.ts:82-84
  // qui active google_search + url_context par défaut.
  if (geminiKey) return 'gemini'

  // Pas de clé Gemini → fallback Mistral (EU, pas de search) sinon Claude
  if (mistralKey) return 'mistral'
  return 'claude'
}
