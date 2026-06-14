/**
 * P1.1 — Mémoire automatique (plan d'action concurrentiel).
 *
 * Extraction asynchrone de faits durables depuis les messages UTILISATEUR
 * (jamais l'assistant — les faits viennent de ce que dit l'utilisateur, et ça
 * élimine toute course avec la finalisation du stream). Les faits sont écrits
 * dans la mémoire LOCALE chiffrée (localMemoryService) — jamais en D1 : la
 * conversation transite par l'endpoint d'extraction le temps d'un appel Haiku,
 * mais aucun fait n'est stocké côté serveur.
 *
 * Déclencheur : ≥ EXTRACT_EVERY_N_USER_MSGS nouveaux messages user depuis la
 * dernière extraction de la conversation, avec un filtre de substance
 * (conversations « ok / merci » exclues). Coût ~0,001 $/extraction (Haiku,
 * via /api/ai/memory-extract — HORS quota utilisateur, cf. endpoint).
 *
 * Garde-fous produit (audit RÈGLE 7) :
 * - euOnly → JAMAIS d'extraction (la conversation ne doit pas partir vers
 *   Claude US — cohérent avec le fact-checker).
 * - Trial débutant (> 25 messages restants) → skip (coût d'acquisition).
 * - Toggle Settings, ON par défaut (la mémoire silencieuse est le facteur de
 *   rétention n°1) + toast discret à chaque mise à jour (confiance).
 */

import * as scoped from './scopedStorage'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
import { getTrialRemaining } from './trialClient'
import {
  getAll as getAllFacts,
  addFact,
  updateFact,
  deleteFact,
  MAX_FACTS,
  type LocalMemoryFact,
} from './localMemoryService'
import type { Conversation } from '../types'
import i18n from '../i18n'
import { toast } from './toast'

const SETTING_KEY = 'auto-memory-enabled'
const PROGRESS_KEY = 'auto-memory-progress'

export const EXTRACT_EVERY_N_USER_MSGS = 3
const MIN_SUBSTANCE_CHARS = 150
const MAX_USER_MSG_CHARS = 800

// ── Settings (pattern promptEnhancerSettings) ────────────────────────────────

export function isAutoMemoryEnabled(): boolean {
  return scoped.getItem(SETTING_KEY) !== 'off'
}

export function setAutoMemoryEnabled(enabled: boolean): void {
  scoped.setItem(SETTING_KEY, enabled ? 'on' : 'off')
}

// ── Suivi de progression par conversation ────────────────────────────────────
// Map convId → nombre de messages user déjà traités. Évite de ré-extraire les
// mêmes messages. Stockage scoped (par compte), non chiffré : ce sont des
// compteurs, pas du contenu.

function getProgress(): Record<string, number> {
  return scoped.getJSON<Record<string, number>>(PROGRESS_KEY) ?? {}
}

function setProgress(convId: string, userCount: number): void {
  const all = getProgress()
  all[convId] = userCount
  // GC simple : garde au plus 100 conversations suivies.
  const keys = Object.keys(all)
  if (keys.length > 100) {
    for (const k of keys.slice(0, keys.length - 100)) delete all[k]
  }
  scoped.setJSON(PROGRESS_KEY, all)
}

// ── Helpers purs (exportés pour les tests) ───────────────────────────────────

/** Les messages ont-ils assez de substance pour mériter une extraction ? */
export function hasSubstance(userMessages: string[]): boolean {
  const total = userMessages.reduce((n, m) => n + m.trim().length, 0)
  return total >= MIN_SUBSTANCE_CHARS
}

/** Transcript des derniers messages user, borné en taille. */
export function buildTranscript(userMessages: string[]): string {
  return userMessages
    .map((m) => `- ${m.slice(0, MAX_USER_MSG_CHARS)}`)
    .join('\n')
}

interface ExtractionResult {
  add: Array<{ fact: string }>
  replace: Array<{ id: string; fact: string }>
}

/** Applique le résultat d'extraction à la mémoire locale. Retourne le nombre
 *  de changements effectifs. Éviction FIFO : la mémoire auto ne doit jamais
 *  échouer silencieusement au cap (bug addFact→null identifié à l'audit) —
 *  le fait le plus ANCIEN est évincé pour faire de la place. */
export function applyExtraction(result: ExtractionResult, existing: LocalMemoryFact[]): number {
  let changes = 0
  for (const r of result.replace) {
    if (updateFact(r.id, r.fact)) changes++
  }
  for (const a of result.add) {
    const current = getAllFacts()
    if (current.length >= MAX_FACTS) {
      const oldest = [...current].sort((x, y) => x.createdAt - y.createdAt)[0]
      if (oldest) deleteFact(oldest.id)
    }
    // Dédup de dernier ressort (le serveur demande déjà à Haiku de comparer) :
    // contenu identique normalisé → skip.
    const norm = a.fact.trim().toLowerCase()
    if (existing.some((f) => f.content.trim().toLowerCase() === norm)) continue
    if (addFact(a.fact)) changes++
  }
  return changes
}

// ── Extraction principale ────────────────────────────────────────────────────

/**
 * Promesse EU : une conversation euOnly — ou qui a simplement touché Mistral
 * (même sémantique que `hasMistralData` dans ChatTopBar, qui déclenche la
 * modale de consentement EU→US) — ne part JAMAIS vers Claude US pour
 * l'extraction mémoire : il n'existe aucun chemin de consentement ici.
 */
export function hasEuData(conv: Pick<Conversation, 'euOnly' | 'usedModels'>): boolean {
  return !!conv.euOnly || !!conv.usedModels?.includes('mistral')
}

let inFlight = false

/**
 * À appeler en fire-and-forget depuis onDone (useConversation). Ne throw
 * jamais, ne bloque jamais l'UI.
 */
export async function maybeExtractMemory(conv: Conversation | null | undefined): Promise<void> {
  try {
    if (!conv || inFlight) return
    if (!isAutoMemoryEnabled()) return
    if (hasEuData(conv)) return
    // Trial débutant : pas d'extraction avant l'engagement (~5 messages).
    const trial = getTrialRemaining()
    if (trial !== null && trial > 25) return

    const userMessages = conv.messages.filter((m) => m.role === 'user').map((m) => m.content)
    const done = getProgress()[conv.id] ?? 0
    if (userMessages.length - done < EXTRACT_EVERY_N_USER_MSGS) return

    const fresh = userMessages.slice(done)
    if (!hasSubstance(fresh)) {
      // Pas de substance : marque quand même la progression pour ne pas
      // re-tester ces messages à chaque réponse.
      setProgress(conv.id, userMessages.length)
      return
    }

    const token = await getValidAccessToken()
    if (!token) return

    inFlight = true
    const existing = getAllFacts()
    const res = await fetch(apiUrl('/api/ai/memory-extract'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-google-token': token,
      },
      body: JSON.stringify({
        transcript: buildTranscript(fresh),
        facts: existing.map((f) => ({ id: f.id, content: f.content })),
      }),
    })

    // Quota d'extraction du jour atteint (20) ou échec : on marque la
    // progression pour ne pas marteler l'endpoint, et on réessaiera
    // naturellement sur les messages suivants.
    setProgress(conv.id, userMessages.length)
    if (!res.ok) return

    const data = (await res.json()) as Partial<ExtractionResult>
    const result: ExtractionResult = {
      add: Array.isArray(data.add) ? data.add.filter((a) => typeof a?.fact === 'string') : [],
      replace: Array.isArray(data.replace)
        ? data.replace.filter((r) => typeof r?.id === 'string' && typeof r?.fact === 'string')
        : [],
    }
    const changes = applyExtraction(result, existing)
    if (changes > 0) {
      // Transparence (stratégie confiance) : jamais de mémorisation invisible.
      try { toast(i18n.t('settings.autoMemory.updated'), 'info') } catch { /* tests */ }
    }
  } catch {
    // Silencieux par design — la mémoire auto ne doit jamais perturber le chat.
  } finally {
    inFlight = false
  }
}
