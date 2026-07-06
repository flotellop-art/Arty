// Fact-checker post-pass : vérifie les claims factuels d'une réponse IA
// avec un second appel Claude (Haiku par défaut, Sonnet en mode strict).
//
// Run AFTER chaque réponse assistant complétée. Le résultat est attaché
// à Message.factCheck et affiché en badge sous la bulle. Async, ne bloque
// pas l'affichage de la réponse — l'utilisateur voit la réponse normale,
// le badge apparaît 1-2 secondes après.
//
// Indépendant du provider qui a généré la réponse (Mistral, Claude, Gemini,
// OpenAI) — le fact-checker prend (question, réponse) en entrée brute.

import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import * as scoped from './scopedStorage'
import * as storage from './storage'
import { recordUsage } from './costTracker'
import type { FactCheckResult, FactCheckClaim } from '../types'

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
  return plan === 'free' || plan === 'trial' ? 'off' : 'auto'
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
// jusqu'au lendemain (évite un aller-retour réseau par message).
let quotaExhaustedDay: string | null = null

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// Compteur local du jour — alimente la ligne « dont X vérifications auto »
// du sheet quotas (affichage indicatif ; la borne réelle est côté serveur).
// BUG 54 : écriture partagée entre vues → CustomEvent à chaque bump.
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
  if (quotaExhaustedDay === today()) return { result: null, reason: FACT_CHECK_QUOTA_REASON }

  const sourcesBlock = formatSearchContext(searchContext)

  // Modes explicites (settings) : un seul palier, pas d'escalade.
  if (mode === 'haiku' || mode === 'sonnet') {
    return runCheckTier(mode, question, response, sourcesBlock)
  }

  // Mode 'auto' (D5) : Haiku d'abord, Sonnet+web_search seulement si la
  // passe rapide remonte au moins un claim risqué.
  const first = await runCheckTier('haiku', question, response, sourcesBlock)
  if (!first.result) return first
  if (!shouldEscalateToSonnet(first.result)) return first

  const escalated = await runCheckTier('sonnet', question, response, sourcesBlock)
  // Si l'escalade échoue (timeout, plafond Sonnet du jour…), le résultat
  // Haiku reste plus utile qu'un badge d'échec.
  return escalated.result ? escalated : first
}

const TIER_INFO = {
  haiku: { model: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', timeoutMs: 10_000 },
  // Sonnet + web_search en non-streamé : Anthropic accumule toute la réponse
  // (2 recherches + synthèse JSON) avant de répondre — 25-30 s typique en
  // prod, 35 s couvre le 95e percentile sans geler le placeholder.
  sonnet: { model: 'claude-sonnet-5', label: 'Sonnet 5', timeoutMs: 35_000 },
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
    // Plafond de fond du jour atteint → suspendre jusqu'à demain ; les
    // appelants skippent SANS badge (raison sentinelle).
    quotaExhaustedDay = today()
    console.info('[factChecker] quota de fond atteint — vérifs suspendues pour la journée')
    return { result: null, reason: FACT_CHECK_QUOTA_REASON }
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    console.warn('[factChecker] endpoint returned non-ok:', res.status, errBody)
    return { result: null, reason: `endpoint ${res.status}${errBody ? ' ' + errBody.slice(0, 60) : ''}` }
  }

  bumpAutoCheckCount()

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
  // On extrait le premier objet JSON valide qu'on trouve.
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    console.warn('[factChecker] no JSON found in response text:', text.slice(0, 200))
    return { result: null, reason: 'pas de JSON dans la réponse LLM' }
  }

  let parsed: { overall_confidence?: unknown; claims?: unknown }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.warn('[factChecker] JSON.parse failed:', err, 'raw:', jsonMatch[0].slice(0, 200))
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

// Pure variant — prend (question, content, mode) et retourne le résultat
// du fact-check + le contenu corrigé (find/replace des claims "wrong"
// appliqué). Aucun side-effect sur le storage. Utilisé par le flow
// "publish-after-fact-check" où on retient la bulle assistant tant que
// la vérif n'a pas fini, pour éviter de montrer le contenu non vérifié.
export interface FactCheckContentOutput {
  correctedContent: string
  result: FactCheckResult | null
  appliedCorrections: number
  // Si result null, raison du fail (timeout, parse, réseau, etc.). Présent
  // uniquement quand le fact-check a vraiment été tenté mais a échoué.
  // ABSENT quand on a skippé intentionnellement (mode off ou réponse
  // triviale) — dans ce cas factCheckContent retourne null tout court.
  // L'appelant utilise cette distinction pour décider d'afficher ou non
  // le badge "⚠ Fact-check indisponible".
  failReason?: string
}

// ---------------------------------------------------------------------------
// Application des corrections — partagée par factCheckContent (flow
// deferPublish, chemin normal) et runFactCheckOnLatest (fallback async).
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

export async function factCheckContent(
  question: string,
  content: string,
  mode: FactCheckMode = getFactCheckMode()
): Promise<FactCheckContentOutput | null> {
  // Récupère le contexte de recherche capturé pendant la génération
  // (Mistral via setSearchContext) puis clear immédiatement pour ne pas
  // polluer le prochain message si le fact-check échoue.
  const ctx = getSearchContext()
  clearSearchContext()
  const outcome = await factCheckResponse(question, content, mode, ctx)
  if (!outcome.result) {
    // Skip intentionnel (mode off, réponse triviale type "Salut !", plafond
    // de fond du jour atteint) → pas de badge. Return null.
    if (
      outcome.reason === 'désactivé' ||
      outcome.reason === 'réponse trop courte' ||
      outcome.reason === FACT_CHECK_QUOTA_REASON
    ) {
      return null
    }
    // Fail réel (timeout, réseau, parse) → on remonte le fail pour que
    // l'appelant affiche le badge "indisponible" et informe l'utilisateur
    // que la vérif n'a pas tourné.
    return { correctedContent: content, result: null, appliedCorrections: 0, failReason: outcome.reason }
  }
  const result = outcome.result

  const { correctedContent, appliedCount } = applyClaimCorrections(content, result.claims)
  if (appliedCount > 0) {
    result.originalContent = content
    result.appliedCorrections = appliedCount
  }
  return { correctedContent, result, appliedCorrections: appliedCount }
}

// Helper end-to-end : trouve le dernier (question, réponse) dans une
// conversation, lance le fact-check, attache le résultat à Message.factCheck
// et persiste. À appeler après chaque onDone d'une réponse assistant.
// Ne fait rien si mode 'off' ou si on ne trouve pas la paire.
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
  if (quotaExhaustedDay === today()) {
    console.info('[factChecker] skipping (' + FACT_CHECK_QUOTA_REASON + ')')
    return
  }

  // Marqueur PENDING immédiat — visible dans l'UI même si le fact-check
  // prend 2-5s. Permet à l'utilisateur de voir que la vérif est active
  // dès la fin du stream. Sera remplacé par le vrai résultat plus bas.
  assistantMsg.factCheck = {
    overallConfidence: 'high',
    claims: [],
    // Le modelLabel exact 'Vérification en cours…' reste load-bearing :
    // le skip-guard plus haut compare cette string pour autoriser la
    // finalisation. status est la source UI (BUG 59), le label le backup.
    modelLabel: 'Vérification en cours…',
    checkedAt: Date.now(),
    status: 'pending',
  }
  storage.saveConversation(conv)
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
  const outcome = await factCheckResponse(userMsg.content, originalContent, mode, ctx)
  if (!outcome.result) {
    console.warn('[factChecker] factCheckResponse returned null —', outcome.reason)
    // C-F — plafond de fond atteint PENDANT cet appel (429) : retirer le
    // placeholder sans badge d'échec — skip intentionnel, pas une panne.
    if (outcome.reason === FACT_CHECK_QUOTA_REASON) {
      const convQ = storage.getConversation(conversationId)
      const targetQ = convQ?.messages.find((m) => m.id === assistantMsg.id)
      if (convQ && targetQ) {
        delete targetQ.factCheck
        storage.saveConversation(convQ)
        refreshConversations()
      }
      return
    }
    // Update le placeholder pour montrer l'échec à l'user (au lieu de
    // laisser "Vérification en cours…" éternellement). On embarque la
    // raison dans le modelLabel pour qu'elle s'affiche dans le badge
    // (visible côté utilisateur sans avoir à ouvrir DevTools).
    const conv2 = storage.getConversation(conversationId)
    if (conv2) {
      const target2 = conv2.messages.find((m) => m.id === assistantMsg.id)
      if (target2) {
        target2.factCheck = {
          overallConfidence: 'medium',
          claims: [],
          modelLabel: `⚠ Fact-check indisponible (${outcome.reason})`,
          checkedAt: Date.now(),
          status: 'failed',
        }
        storage.saveConversation(conv2)
        refreshConversations()
      }
    }
    return
  }
  const result = outcome.result

  // Applique les corrections (helper partagé avec factCheckContent — même
  // matching exact + tolérant, mêmes flags claim.applied). On garde
  // l'original dans factCheck.originalContent pour le diff du dropdown.
  const { correctedContent, appliedCount } = applyClaimCorrections(originalContent, result.claims)
  if (appliedCount > 0) {
    result.originalContent = originalContent
    result.appliedCorrections = appliedCount
  }

  // Re-lit la conv (peut avoir changé pendant l'await) et update le message
  // exact via son ID.
  const freshConv = storage.getConversation(conversationId)
  if (!freshConv) return
  const target = freshConv.messages.find((m) => m.id === assistantMsg.id)
  if (!target) return
  target.content = correctedContent
  target.factCheck = result
  freshConv.updatedAt = Date.now()
  storage.saveConversation(freshConv)
  refreshConversations()
}
