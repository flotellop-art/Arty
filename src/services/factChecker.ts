// Fact-checker post-pass : vérifie les claims factuels d'une réponse IA
// avec un second appel Claude (Haiku d'abord, escalade Sonnet sur risque).
//
// Run AFTER chaque réponse assistant complétée. ENTIÈREMENT ASYNCHRONE
// depuis le retrait du mode « publish-after-fact-check » (juillet 2026) :
// la réponse streame et se publie immédiatement, le badge passe par
// pending → résultat, et les corrections sont RÉTRO-APPLIQUÉES sur le
// message publié avec le diff barré→corrigé visible dans le badge (pas de
// bascule silencieuse). L'ancien mode retenait la bulle pendant toute la
// génération + la vérif (jusqu'à ~45 s de TypingIndicator) — plainte
// « fact-check lent » de juillet 2026.
//
// Indépendant du provider qui a généré la réponse (Mistral, Claude, Gemini,
// OpenAI) — le fact-checker prend (question, réponse) en entrée brute.

import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import * as scoped from './scopedStorage'
import * as storage from './storage'
import { recordUsage } from './costTracker'
import type { FactCheckResult, FactCheckClaim, Message } from '../types'
import { getMessageTextForModel } from './quickActions'

export type Verdict = FactCheckClaim['verdict']
export type { FactCheckResult, FactCheckClaim }

// ─────────────────────────────────────────────────────────────────────────────
// Search context — résultats des recherches web faites pendant la génération
// de la réponse (Mistral via Linkup, Claude via web_search natif Anthropic,
// Gemini via google_search). Le fact-checker utilise ces sources fraîches
// pour vérifier les claims plutôt que de se reposer sur son cutoff de
// connaissance — c'est la différence majeure v1 → v2 du fact-checker.
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchContextSource {
  title: string
  url: string
  snippet: string
}

export interface SearchContext {
  provider: string
  query: string
  // Réponse synthétisée par le provider (Linkup sourcedAnswer)
  answer?: string
  // Résultats simples (single-source)
  results?: SearchContextSource[]
  // Résultats multi-source (Option A : bricodepot.fr → ..., cedeo.fr → ...)
  bySource?: Record<string, { answer?: string; results: SearchContextSource[] }>
}

// Module-level — Arty est mono-user dans un onglet, pas de race possible
// entre conversations. setSearchContext est appelé par les clients AI au
// moment de l'appel à un tool de recherche, getSearchContext est lu par
// runFactCheckOnLatest puis clearSearchContext reset pour le prochain tour.
let activeSearchContext: SearchContext | null = null

export function setSearchContext(ctx: SearchContext): void {
  activeSearchContext = ctx
}

export function getSearchContext(): SearchContext | null {
  return activeSearchContext
}

export function clearSearchContext(): void {
  activeSearchContext = null
}

// ─────────────────────────────────────────────────────────────────────────────

export type FactCheckMode = 'off' | 'auto' | 'haiku' | 'sonnet'

const SETTING_KEY = 'fact-check-mode'

export function getFactCheckMode(): FactCheckMode {
  const v = scoped.getItem(SETTING_KEY)
  if (v === 'off' || v === 'sonnet' || v === 'haiku' || v === 'auto') return v
  // Défaut : 'auto' pour les payants (Haiku rapide / Sonnet sur sujets
  // sensibles), 'off' pour les free ET les essais (cap quota). 'trial' :
  // défensif — rien ne l'écrit aujourd'hui (l'essai est normalisé 'free'),
  // mais si status.ts distingue un jour, le fact-check ne doit pas basculer
  // en Sonnet pour un compte d'essai (C-E).
  let plan: string | null = null
  try { plan = localStorage.getItem('arty-plan-cache') } catch {}
  // 'pro' aussi → off (revue PR 5) : Pro = BYOK sans clé serveur (PR #287),
  // l'endpoint fact-check répond 403 — tenter à chaque réponse ajoutait un
  // badge d'échec systématique + la latence réseau dans l'ex-flux deferPublish.
  // Un réglage EXPLICITE (posé plus haut) prime toujours sur ce défaut.
  return plan === 'free' || plan === 'trial' || plan === 'pro' ? 'off' : 'auto'
}

export function setFactCheckMode(mode: FactCheckMode): void {
  scoped.setItem(SETTING_KEY, mode)
  try { window.dispatchEvent(new CustomEvent('fact-check-mode-changed', { detail: mode })) } catch {}
}

// C-F (CDC visibilité modèle, décision D5) — mode 'auto' = HAIKU D'ABORD,
// escalade Sonnet + web_search UNIQUEMENT si la passe Haiku détecte des
// claims risqués (wrong/uncertain). Historique : depuis le 11 mai 2026,
// 'auto' routait TOUT vers Sonnet+web (fiabilité) — mais chaque réponse
// vérifiée consommait 1 unité du cap premium mensuel de l'abonné (150
// Sonnet/Opus ≈ 75 vrais échanges, audit F-15). Désormais :
//  - la plupart des vérifs s'arrêtent à Haiku (rapide, quasi gratuit) ;
//  - l'escalade Sonnet ne part que sur du risque détecté ;
//  - TOUT passe par l'endpoint dédié /api/ai/fact-check (pattern
//    memory-extract) : HORS cap premium et quota journalier, borné par son
//    propre plafond de fond (60 Haiku + 15 Sonnet / jour, côté serveur).
// Le prompt système vit CÔTÉ SERVEUR (functions/api/ai/fact-check.ts) —
// l'endpoint n'accepte que {tier, question, response, sources} : il ne peut
// pas servir de proxy Claude générique.

const FACT_CHECK_ENDPOINT = '/api/ai/fact-check'

// Raison sentinelle du skip quota — les appelants la traitent comme un skip
// INTENTIONNEL (pas de badge « indisponible » à chaque message une fois le
// plafond de fond du jour atteint).
export const FACT_CHECK_QUOTA_REASON = 'quota de fond atteint'

// Une fois le 429 fact_check_quota reçu, on arrête d'appeler l'endpoint
// jusqu'au lendemain (évite un aller-retour réseau par message). PAR PALIER
// (revue Sonnet PR 5) : les plafonds serveur sont asymétriques (60 Haiku /
// 15 Sonnet par jour) — un flag global posé par le 429 Sonnet bloquait
// silencieusement les ~45 vérifs Haiku restantes de la journée, défaisant
// l'objectif « Haiku d'abord » du chantier.
const quotaExhaustedDayByTier: { haiku: string | null; sonnet: string | null } = {
  haiku: null,
  sonnet: null,
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Le palier d'ENTRÉE du mode donné est-il épuisé pour aujourd'hui ?
    (mode sonnet explicite → palier sonnet ; auto/haiku → palier haiku).
    Exporté pour le pré-garde de runFactCheckOnLatest. */
export function isFactCheckQuotaExhausted(mode: FactCheckMode = getFactCheckMode()): boolean {
  const tier = mode === 'sonnet' ? 'sonnet' : 'haiku'
  return quotaExhaustedDayByTier[tier] === today()
}

// Compteur local du jour — alimente la ligne « dont X vérifications auto »
// du sheet quotas (affichage indicatif ; la borne réelle est côté serveur).
// Compte les vérifications LOGIQUES (une escalade Haiku→Sonnet = 1), pas les
// appels API. BUG 54 : écriture partagée entre vues → CustomEvent au bump.
const COUNT_KEY_PREFIX = 'factcheck-count-'

function bumpAutoCheckCount(): void {
  try {
    const key = COUNT_KEY_PREFIX + today()
    const cur = parseInt(scoped.getItem(key) || '0', 10)
    scoped.setItem(key, String((Number.isFinite(cur) ? cur : 0) + 1))
    window.dispatchEvent(new CustomEvent('arty-factcheck-count-changed'))
  } catch { /* compteur d'affichage — jamais bloquant */ }
}

export function getAutoCheckCountToday(): number {
  try {
    const n = parseInt(scoped.getItem(COUNT_KEY_PREFIX + today()) || '0', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

// Critère d'escalade Haiku → Sonnet (exporté pour test) : au moins un claim
// non « verified ». Un résultat Haiku entièrement vert est final — inutile
// de payer Sonnet + web_search pour re-confirmer du déjà-vérifié.
export function shouldEscalateToSonnet(result: FactCheckResult): boolean {
  return result.claims.some((c) => c.verdict !== 'verified')
}

function formatSearchContext(ctx: SearchContext | null): string {
  if (!ctx) return ''
  const parts: string[] = ['\n\nSOURCES WEB CONSULTÉES :', `Provider: ${ctx.provider}`, `Query: ${ctx.query}`]
  if (ctx.answer) {
    parts.push(`Réponse synthétisée: ${ctx.answer.slice(0, 2000)}`)
  }
  if (ctx.results && ctx.results.length > 0) {
    parts.push('Sources :')
    ctx.results.slice(0, 8).forEach((r, i) => {
      parts.push(`[${i + 1}] ${r.title}\n  URL: ${r.url}\n  Extrait: ${r.snippet.slice(0, 400)}`)
    })
  }
  if (ctx.bySource) {
    parts.push('Recherche multi-source :')
    for (const [source, entry] of Object.entries(ctx.bySource).slice(0, 6)) {
      parts.push(`### ${source}`)
      if (entry.answer) parts.push(`Synthèse: ${entry.answer.slice(0, 1000)}`)
      entry.results.slice(0, 4).forEach((r, i) => {
        parts.push(`  [${i + 1}] ${r.title} — ${r.url}\n    ${r.snippet.slice(0, 300)}`)
      })
    }
  }
  return parts.join('\n')
}

/**
 * Extrait le premier objet JSON à accolades ÉQUILIBRÉES d'un texte LLM
 * (backticks, prose avant/après tolérés). Retourne null si aucun objet ne
 * se ferme — typiquement un JSON tronqué par max_tokens : mieux vaut un
 * échec franc (« pas de JSON ») qu'un JSON.parse sur une capture greedy.
 * Exporté pour les tests.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text.charAt(i)
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Résultat de factCheckResponse. En cas d'échec, on capture la raison
 * (timeout/401/parse fail/…) pour afficher dans le badge UI au lieu d'un
 * générique "indisponible". Permet le diagnostic en prod sans logs.
 */
export type FactCheckOutcome =
  | { result: FactCheckResult }
  | { result: null; reason: string }

export async function factCheckResponse(
  question: string,
  response: string,
  mode: FactCheckMode = getFactCheckMode(),
  searchContext: SearchContext | null = null
): Promise<FactCheckOutcome> {
  if (mode === 'off') return { result: null, reason: 'désactivé' }
  if (!response || response.length < 80) return { result: null, reason: 'réponse trop courte' }
  if (isFactCheckQuotaExhausted(mode)) return { result: null, reason: FACT_CHECK_QUOTA_REASON }

  const sourcesBlock = formatSearchContext(searchContext)
  // Une vérification LOGIQUE réussie = 1 au compteur (même si escalade).
  const done = (o: FactCheckOutcome): FactCheckOutcome => {
    if (o.result) bumpAutoCheckCount()
    return o
  }

  // Modes explicites (settings) : un seul palier, pas d'escalade.
  if (mode === 'haiku' || mode === 'sonnet') {
    return done(await runCheckTier(mode, question, response, sourcesBlock))
  }

  // Mode 'auto' (D5) : Haiku d'abord, Sonnet+web_search seulement si la
  // passe rapide remonte au moins un claim risqué.
  const first = await runCheckTier('haiku', question, response, sourcesBlock)
  if (!first.result) return first
  if (!shouldEscalateToSonnet(first.result)) return done(first)
  // Palier Sonnet du jour déjà épuisé → le résultat Haiku est final (le
  // palier Haiku, lui, reste disponible pour les prochains messages).
  if (quotaExhaustedDayByTier.sonnet === today()) return done(first)

  const escalated = await runCheckTier('sonnet', question, response, sourcesBlock)
  // Si l'escalade échoue (timeout, plafond Sonnet du jour…), le résultat
  // Haiku reste plus utile qu'un badge d'échec.
  return done(escalated.result ? escalated : first)
}

// Timeouts client GÉNÉREUX depuis que la vérif est asynchrone (publication
// immédiate) : ils ne gèlent plus aucune UI, ils bornent seulement le moment
// où le badge bascule en « indisponible ». Un abort client trop court est
// du pur gaspillage : le quota bg_quota est consommé à l'entrée de
// l'endpoint et l'appel Anthropic va au bout côté Worker — on paie la
// vérif et on jette le résultat. Doit couvrir le timeout upstream serveur
// par palier (15 s Haiku / 50 s Sonnet) + retry serveur + réseau.
const TIER_INFO = {
  haiku: { model: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', timeoutMs: 25_000 },
  // Sonnet + web_search en non-streamé : Anthropic accumule toute la réponse
  // (jusqu'à 3 recherches + synthèse JSON) avant de répondre — 25-30 s
  // typique en prod.
  sonnet: { model: 'claude-sonnet-5', label: 'Sonnet 5', timeoutMs: 60_000 },
} as const

async function runCheckTier(
  tier: 'haiku' | 'sonnet',
  question: string,
  response: string,
  sourcesBlock: string
): Promise<FactCheckOutcome> {
  const info = TIER_INFO[tier]

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const googleToken = await getValidAccessToken()
  if (googleToken) headers['x-google-token'] = googleToken

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), info.timeoutMs)

  let res: Response
  try {
    res = await fetch(apiUrl(FACT_CHECK_ENDPOINT), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tier,
        question: question.slice(0, 2000),
        response: response.slice(0, 6000),
        sources: sourcesBlock,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[factChecker] timeout after', info.timeoutMs, 'ms')
      return { result: null, reason: `timeout ${info.timeoutMs / 1000}s` }
    }
    console.warn('[factChecker] fetch failed:', err)
    const msg = err instanceof Error ? err.message : 'erreur réseau'
    return { result: null, reason: `réseau (${msg.slice(0, 60)})` }
  }
  clearTimeout(timeoutId)

  if (res.status === 429) {
    // Plafond de fond du PALIER atteint → suspendre CE palier jusqu'à
    // demain ; les appelants skippent SANS badge (raison sentinelle).
    quotaExhaustedDayByTier[tier] = today()
    console.info('[factChecker] quota de fond ' + tier + ' atteint — palier suspendu pour la journée')
    return { result: null, reason: FACT_CHECK_QUOTA_REASON }
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.warn('[factChecker] endpoint returned non-ok:', res.status, errBody)
    return { result: null, reason: `endpoint ${res.status}${errBody ? ' ' + errBody.slice(0, 60) : ''}` }
  }

  let text = ''
  try {
    const data = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
    }
    // On cherche le DERNIER bloc text. Avec web_search activé, la réponse
    // contient [server_tool_use, web_search_tool_result, text (commentaire),
    //  server_tool_use, web_search_tool_result, text (JSON final)] — il
    // faut prendre le dernier, qui porte le JSON. Sans web_search, il n'y
    // a qu'un seul bloc text → le résultat est le même. Boucle inverse
    // plutôt que `.findLast()` parce que la lib TS cible ES2020.
    const blocks = data.content || []
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]
      if (b && b.type === 'text' && b.text) {
        text = b.text
        break
      }
    }
    // H-AI-4 — tracking LOCAL (fallback BYOK/offline du dashboard). Le coût
    // D1 (source de vérité, BUG 60) est tracé côté endpoint fact-check.
    if (data.usage) {
      try {
        const inputT = (data.usage.input_tokens || 0) + (data.usage.cache_read_input_tokens || 0)
        const outputT = data.usage.output_tokens || 0
        recordUsage(info.model, inputT, outputT)
      } catch { /* tracking doit pas casser */ }
    }
  } catch (err) {
    console.warn('[factChecker] response.json() failed:', err)
    return { result: null, reason: 'parse JSON HTTP fail' }
  }
  if (!text) {
    console.warn('[factChecker] no text in response')
    return { result: null, reason: 'réponse vide' }
  }

  // Le LLM peut wrapper le JSON dans des backticks ou ajouter du texte.
  // Extraction à accolades équilibrées (l'ancien regex greedy /\{[\s\S]*\}/
  // capturait jusqu'à la DERNIÈRE accolade du texte — du commentaire après
  // le JSON suffisait à produire un « JSON malformé »).
  const candidate = extractJsonObject(text)
  if (!candidate) {
    console.warn('[factChecker] no JSON found in response text:', text.slice(0, 200))
    return { result: null, reason: 'pas de JSON dans la réponse LLM' }
  }

  let parsed: { overall_confidence?: unknown; claims?: unknown }
  try {
    parsed = JSON.parse(candidate)
  } catch (err) {
    console.warn('[factChecker] JSON.parse failed:', err, 'raw:', candidate.slice(0, 200))
    return { result: null, reason: 'JSON malformé' }
  }

  const overall = parsed.overall_confidence
  const overallConfidence: FactCheckResult['overallConfidence'] =
    overall === 'high' || overall === 'medium' || overall === 'low' ? overall : 'medium'

  const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : []
  const claims: FactCheckClaim[] = rawClaims
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => {
      const verdict = c.verdict === 'verified' || c.verdict === 'uncertain' || c.verdict === 'wrong'
        ? c.verdict
        : 'uncertain'
      const claim: FactCheckClaim = {
        claim: String(c.claim || '').slice(0, 500),
        verdict: verdict as Verdict,
        explanation: String(c.explanation || '').slice(0, 500),
      }
      // Correction proposée — uniquement pour 'wrong' avec originalText et
      // correction présents. Le fact-checker doit fournir le passage
      // EXACT à remplacer pour qu'on puisse faire un find/replace fiable.
      if (verdict === 'wrong' && typeof c.originalText === 'string' && typeof c.correction === 'string') {
        const orig = c.originalText.trim()
        const corr = c.correction.trim()
        if (orig.length > 0 && orig.length < 500 && corr.length > 0 && corr.length < 500) {
          claim.originalText = orig
          claim.correction = corr
        }
      }
      return claim
    })
    .filter((c) => c.claim.length > 0)
    .slice(0, 10) // cap à 10 claims max pour éviter une explosion UI

  return {
    result: {
      overallConfidence,
      claims,
      modelLabel: info.label,
      checkedAt: Date.now(),
      // BUG 59 — status structuré : succès "vide" = aucun claim risqué
      // (wrong/uncertain), succès "avec claims" = au moins un à signaler.
      status: claims.some((c) => c.verdict !== 'verified')
        ? 'success-with-claims'
        : 'success-empty',
    },
  }
}

// ---------------------------------------------------------------------------
// Application des corrections — consommée par runFactCheckOnLatest (chemin
// unique depuis le retrait du mode publish-after-fact-check).
// Bug live du 11 juin 2026 : le remplacement était un `includes()` verbatim
// qui ratait silencieusement dès que le fact-checker citait le passage sans
// son markdown (**gras**), avec une apostrophe droite là où la réponse en a
// une courbe, un espace insécable, un tiret différent… et le badge affichait
// quand même « barré → corrigé ». Stratégie :
//   1) match exact → remplace TOUTES les occurrences (comportement
//      historique, équivalent replaceAll absent de la cible ES2020) ;
//   2) sinon match TOLÉRANT sur une version normalisée (markdown */_ ignoré,
//      apostrophes/tirets/degrés/espaces unifiés, casse pliée) avec table
//      d'index pour remplacer le passage RÉEL dans le texte original.
//      Garde-fous anti sur-remplacement : passage ≥ 10 chars et exactement
//      1 occurrence normalisée, sinon abandon.
// Chaque claim reçoit `applied` pour que le badge dise la vérité (un claim
// peut matcher pendant qu'un autre rate dans le même message).

interface NormalizedText {
  norm: string
  /** map[i] = index, dans le texte original, du i-ème caractère de norm. */
  map: number[]
}

function normalizeForMatch(text: string): NormalizedText {
  const norm: string[] = []
  const map: number[] = []
  let lastWasSpace = false
  for (let i = 0; i < text.length; i++) {
    let ch = text.charAt(i)
    if (ch === '*' || ch === '_') continue // emphase markdown — ignorée
    if (ch === '’' || ch === '‘') ch = "'" // apostrophes courbes
    else if (ch === 'º') ch = '°' // º ordinal → ° degré
    else if (ch === '–' || ch === '—') ch = '-' // – — → -
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue // espaces consécutifs (insécables inclus) pliés
      ch = ' '
      lastWasSpace = true
    } else {
      lastWasSpace = false
    }
    norm.push(ch.toLowerCase())
    map.push(i)
  }
  return { norm: norm.join(''), map }
}

const MIN_FUZZY_MATCH_LENGTH = 10

export function applyClaimCorrections(
  content: string,
  claims: FactCheckClaim[],
): { correctedContent: string; appliedCount: number } {
  let corrected = content
  let appliedCount = 0
  for (const c of claims) {
    if (c.verdict !== 'wrong' || !c.originalText || !c.correction) continue
    c.applied = false

    if (corrected.includes(c.originalText)) {
      corrected = corrected.split(c.originalText).join(c.correction)
      c.applied = true
      appliedCount++
      continue
    }

    if (c.originalText.length < MIN_FUZZY_MATCH_LENGTH) continue
    const { norm, map } = normalizeForMatch(corrected)
    const target = normalizeForMatch(c.originalText).norm
    if (target.length === 0) continue
    const first = norm.indexOf(target)
    if (first === -1 || norm.indexOf(target, first + 1) !== -1) continue
    const start = map[first]
    const last = map[first + target.length - 1]
    if (start === undefined || last === undefined) continue
    // Le span original couvre aussi les caractères ignorés intérieurs
    // (**, espaces doublés). Les ** encadrants restent en place : remplacer
    // l'intérieur d'un **…** conserve le gras, balancé.
    corrected = corrected.slice(0, start) + c.correction + corrected.slice(last + 1)
    c.applied = true
    appliedCount++
  }
  return { correctedContent: corrected, appliedCount }
}

// Remplacement IMMUTABLE d'un message (pattern H1/togglePinMessage) : muter
// le message en place laisse les mêmes références objet/array → les memo()
// de MessageList/MessageItem ne re-rendent jamais le badge ni la correction
// rétro-appliquée. C'est load-bearing depuis que le fact-check est le chemin
// asynchrone unique : plus aucun finalize ne suit pour « couvrir » l'écriture.
// `patch` retourne le message remplaçant (objet NEUF, jamais le même muté).
function patchMessage(
  conversationId: string,
  messageId: string,
  patch: (m: Message) => Message,
  bumpUpdatedAt = false
): void {
  const conv = storage.getConversation(conversationId)
  if (!conv) return
  let found = false
  conv.messages = conv.messages.map((m) => {
    if (m.id !== messageId) return m
    found = true
    return patch(m)
  })
  if (!found) return
  if (bumpUpdatedAt) conv.updatedAt = Date.now()
  storage.saveConversation(conv)
}

// Helper end-to-end : trouve le dernier (question, réponse) dans une
// conversation, lance le fact-check, attache le résultat à Message.factCheck
// et persiste. À appeler après chaque onDone d'une réponse assistant.
// Ne fait rien si mode 'off', conversation EU, réponse interrompue, ou si
// on ne trouve pas la paire.
export async function runFactCheckOnLatest(
  conversationId: string,
  refreshConversations: () => void
): Promise<void> {
  const mode = getFactCheckMode()
  if (mode === 'off') {
    console.info('[factChecker] skipped (mode=off)')
    return
  }
  console.info('[factChecker] starting (mode=' + mode + ')')

  const conv = storage.getConversation(conversationId)
  if (!conv) {
    console.warn('[factChecker] conv not found:', conversationId)
    return
  }

  // RGPD (RÈGLE 5.3) — défense en profondeur : le fact-checker tourne sur
  // Claude (Anthropic, serveurs US). Une conversation euOnly ne doit JAMAIS
  // arriver ici — le call site (useConversation) force déjà mode 'off' sur
  // les convs EU, mais ce garde doit AUSSI vivre dans le service : un futur
  // appelant qui oublierait le gate enverrait question + réponse (mails/
  // Drive inclus) hors Europe en silence.
  if (conv.euOnly) {
    console.info('[factChecker] skipped (conversation EU — RÈGLE 5.3)')
    return
  }

  // Trouver le dernier message assistant non-streaming
  let lastAssistantIdx = -1
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]
    if (m && m.role === 'assistant' && m.id !== 'streaming') {
      lastAssistantIdx = i
      break
    }
  }
  if (lastAssistantIdx < 0) return

  // Trouver le user message qui le précède
  let userMsg: typeof conv.messages[number] | undefined
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (conv.messages[i]?.role === 'user') {
      userMsg = conv.messages[i]
      break
    }
  }
  if (!userMsg) {
    console.warn('[factChecker] no user msg before assistant idx', lastAssistantIdx)
    return
  }

  const assistantMsg = conv.messages[lastAssistantIdx]!
  // Réponse interrompue (bouton Stop) : contenu partiel — vérifier ou
  // « corriger » une réponse tronquée n'a pas de sens et gaspille le quota
  // de fond. Remplace le garde H4 du flow deferPublish supprimé.
  if (assistantMsg.interrupted) {
    console.info('[factChecker] skipping (réponse interrompue)')
    return
  }
  // Skip si déjà fact-checké ET ce n'est PAS le placeholder pending
  // (sinon on ne pourrait jamais finaliser).
  if (assistantMsg.factCheck && assistantMsg.factCheck.modelLabel !== 'Vérification en cours…') {
    console.info('[factChecker] already fact-checked, skipping')
    return
  }

  // Skip silencieux si la réponse est trop courte pour valoir un fact-check
  // (salutations, "ok", "merci", etc.). Même seuil que factCheckResponse.
  // Sans cet early-return, le placeholder "Vérification en cours…" serait
  // setté puis remplacé par "⚠ Fact-check indisponible (réponse trop courte)"
  // sur des bulles triviales — bruit UI inutile pour l'utilisateur.
  if (!assistantMsg.content || assistantMsg.content.length < 80) {
    console.info('[factChecker] skipping (réponse trop courte)')
    return
  }

  // C-F — plafond de fond du jour déjà atteint : skip AVANT de poser le
  // placeholder (sinon chaque message afficherait « Vérification en
  // cours… » puis rien). Même logique silencieuse que le mode off.
  if (isFactCheckQuotaExhausted(mode)) {
    console.info('[factChecker] skipping (' + FACT_CHECK_QUOTA_REASON + ')')
    return
  }

  // Marqueur PENDING immédiat — visible dans l'UI même si le fact-check
  // prend 2-45s. Permet à l'utilisateur de voir que la vérif est active
  // dès la fin du stream. Sera remplacé par le vrai résultat plus bas.
  const pendingFactCheck: FactCheckResult = {
    overallConfidence: 'high',
    claims: [],
    // Le modelLabel exact 'Vérification en cours…' reste load-bearing :
    // le skip-guard plus haut compare cette string pour autoriser la
    // finalisation. status est la source UI (BUG 59), le label le backup.
    modelLabel: 'Vérification en cours…',
    checkedAt: Date.now(),
    status: 'pending',
  }
  patchMessage(conversationId, assistantMsg.id, (m) => ({ ...m, factCheck: pendingFactCheck }))
  refreshConversations()

  const originalContent = assistantMsg.content
  // Récupère le contexte de recherche capturé pendant la génération
  // (Mistral via setSearchContext dans executeMistralWebSearch). Permet
  // au fact-checker de comparer les claims aux SOURCES RÉELLES plutôt
  // que de se reposer sur son cutoff de connaissance — c'est la
  // différence v1 → v2.
  const ctx = getSearchContext()
  // On clear immédiatement pour ne pas pollluer le prochain message si
  // le fact-check échoue ou si l'IA ne lance pas de search.
  clearSearchContext()
  const outcome = await factCheckResponse(
    getMessageTextForModel(userMsg),
    originalContent,
    mode,
    ctx,
  )
  if (!outcome.result) {
    console.warn('[factChecker] factCheckResponse returned null —', outcome.reason)
    // C-F — plafond de fond atteint PENDANT cet appel (429) : retirer le
    // placeholder sans badge d'échec — skip intentionnel, pas une panne.
    if (outcome.reason === FACT_CHECK_QUOTA_REASON) {
      patchMessage(conversationId, assistantMsg.id, (m) => {
        const { factCheck: _dropped, ...rest } = m
        return rest
      })
      refreshConversations()
      return
    }
    // Update le placeholder pour montrer l'échec à l'user (au lieu de
    // laisser "Vérification en cours…" éternellement). On embarque la
    // raison dans le modelLabel pour qu'elle s'affiche dans le badge
    // (visible côté utilisateur sans avoir à ouvrir DevTools).
    const failedFactCheck: FactCheckResult = {
      overallConfidence: 'medium',
      claims: [],
      modelLabel: `⚠ Fact-check indisponible (${outcome.reason})`,
      checkedAt: Date.now(),
      status: 'failed',
    }
    patchMessage(conversationId, assistantMsg.id, (m) => ({ ...m, factCheck: failedFactCheck }))
    refreshConversations()
    return
  }
  const result = outcome.result

  // Applique les corrections (matching exact + tolérant, flags
  // claim.applied). On garde l'original dans factCheck.originalContent
  // pour le diff du dropdown.
  const { correctedContent, appliedCount } = applyClaimCorrections(originalContent, result.claims)
  if (appliedCount > 0) {
    result.originalContent = originalContent
    result.appliedCorrections = appliedCount
  }

  // patchMessage re-lit la conv (elle peut avoir changé pendant l'await) et
  // remplace le message exact via son ID — si le message a disparu entre
  // temps (régénération, suppression), aucune écriture.
  patchMessage(
    conversationId,
    assistantMsg.id,
    (m) => ({ ...m, content: correctedContent, factCheck: result }),
    true
  )
  refreshConversations()
}
