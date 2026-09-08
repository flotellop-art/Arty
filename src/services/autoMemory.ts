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
 * (conversations « ok / merci » exclues). Appel Haiku financé par Arty,
 * via /api/ai/memory-extract — HORS quota utilisateur, cf. endpoint.
 *
 * Garde-fous produit (audit RÈGLE 7) :
 * - euOnly → JAMAIS d'extraction (la conversation ne doit pas partir vers
 *   Claude US — cohérent avec le fact-checker).
 * - Essai/Free ou plan non vérifié : aucune extraction IA supplémentaire.
 * - Toggle Settings, ON par défaut (la mémoire silencieuse est le facteur de
 *   rétention n°1) + toast discret à chaque mise à jour (confiance).
 */

import { hasPaidServerFeatures } from './paidFeatures'
import * as scoped from './scopedStorage'
import { apiUrl } from './apiBase'
import { captureGoogleGrant, onGoogleGrantInvalidated } from './googleAuth'
import {
  getAll as getAllFacts,
  bootstrapLocalMemory,
  mutateLocalMemory,
  createLocalMemoryFact,
  MAX_FACTS,
  type LocalMemoryFact,
} from './localMemoryService'
import type { Conversation } from '../types'
import { isDocumentConversation } from './projects/chatPolicy'
import i18n from '../i18n'
import { toast } from './toast'
import { beginConversationWork } from './conversationWork'
import { captureLocalReadScope } from './projects/store'
import { onLocalDataInvalidated } from './localDataInvalidation'
import { documentWorkspaceSignal } from './workspaceWriter/runtime'

const SETTING_KEY = 'auto-memory-enabled'
const PROGRESS_KEY = 'auto-memory-progress'

export const EXTRACT_EVERY_N_USER_MSGS = 3
const MIN_SUBSTANCE_CHARS = 150
const MAX_USER_MSG_CHARS = 800
// Transport mirrors the extraction endpoint, without changing stored content.
const MAX_TRANSCRIPT_CHARS = 6000
const MAX_TRANSPORT_FACTS = 80
const MAX_TRANSPORT_ID_CHARS = 64

// ── Settings (pattern promptEnhancerSettings) ────────────────────────────────

export function isAutoMemoryEnabled(): boolean {
  return scoped.getItem(SETTING_KEY) !== 'off'
}

export function setAutoMemoryEnabled(enabled: boolean): void {
  scoped.setItem(SETTING_KEY, enabled ? 'on' : 'off')
}

// ── Suivi de progression par conversation ────────────────────────────────────
// Map convId → nombre de messages user déjà tentés (pas forcément mémorisés).
// Une réponse inconnue ne permet pas de refaire automatiquement le même appel.
// Stockage scoped (par compte), non chiffré : ce sont des
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
  let transcript = ''
  for (const message of userMessages) {
    const line = `${transcript ? '\n' : ''}- ${message.slice(0, MAX_USER_MSG_CHARS)}`
    transcript += line.slice(0, MAX_TRANSCRIPT_CHARS - transcript.length)
    if (transcript.length >= MAX_TRANSCRIPT_CHARS) break
  }
  return transcript
}

function projectExtractionFacts(facts: LocalMemoryFact[]): Array<{ id: string; content: string }> {
  const projected: Array<{ id: string; content: string }> = []
  for (const fact of facts) {
    if (projected.length >= MAX_TRANSPORT_FACTS) break
    if (typeof fact?.id !== 'string' || fact.id.length > MAX_TRANSPORT_ID_CHARS || !/^lm-[\w-]+$/.test(fact.id)) continue
    if (typeof fact.content !== 'string') continue
    const content = fact.content.slice(0, 200)
    if (!content.trim()) continue
    projected.push({ id: fact.id, content })
  }
  return projected
}

interface ExtractionResult {
  add: Array<{ fact: string }>
  replace: Array<{ id: string; fact: string }>
}

/** Applique le résultat d'extraction à la mémoire locale. Retourne le nombre
 *  de changements effectifs. Éviction FIFO : la mémoire auto ne doit jamais
 *  échouer silencieusement au cap (bug addFact→null identifié à l'audit) —
 *  le fait le plus ANCIEN est évincé pour faire de la place. */
export async function applyExtraction(result: ExtractionResult, existing: LocalMemoryFact[], assertCurrent: () => void = () => {}): Promise<number> {
  if (!result.add.length && !result.replace.length) return 0
  return mutateLocalMemory(current => {
  let changes = 0
  for (const r of result.replace) {
    assertCurrent()
    const original = existing.find(f => f.id === r.id)
    const fact = current.find(f => f.id === r.id)
    if (!original || !fact || fact.content !== original.content || fact.createdAt !== original.createdAt || !r.fact.trim() || fact.content === r.fact.trim()) continue
    fact.content = r.fact.trim(); changes++
  }
  for (const a of result.add) {
    assertCurrent()
    const norm = a.fact.trim().toLowerCase()
    if (!norm || current.some(f => f.content.trim().toLowerCase() === norm)) continue
    if (current.length >= MAX_FACTS) {
      const oldest = [...current].sort((x, y) => x.createdAt - y.createdAt)[0]
      if (oldest) current.splice(current.findIndex(f => f.id === oldest.id), 1)
    }
    current.push(createLocalMemoryFact(a.fact)); changes++
    assertCurrent()
  }
  return changes
  }, assertCurrent)
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

/** Cancel this consumer's wait, never the shared Google refresh. */
function waitForMemory<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => { cleanup(); reject(new Error('memory_cancelled')) }
    if (signal.aborted) { void promise.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

/**
 * À appeler en fire-and-forget depuis onDone (useConversation). Ne throw
 * jamais, ne bloque jamais l'UI.
 */
export async function maybeExtractMemory(conv: Conversation | null | undefined): Promise<void> {
  let finishWork: (() => void) | undefined
  let dispose = () => {}
  try {
    if (!hasPaidServerFeatures()) return
    if (!conv || inFlight) return
    if (isDocumentConversation(conv)) return
    if (!isAutoMemoryEnabled()) return
    if (hasEuData(conv)) return

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

    const grant = captureGoogleGrant()
    if (!grant) return
    const lifetime = new AbortController(), scope = captureLocalReadScope(lifetime.signal)
    const abort = () => lifetime.abort()
    const assertCurrent = () => {
      scope.assertCurrent()
      if (!hasPaidServerFeatures() || !grant.isCurrent() || lifetime.signal.aborted || documentWorkspaceSignal.aborted
        || !isAutoMemoryEnabled() || hasEuData(conv) || isDocumentConversation(conv)) throw new Error('memory_cancelled')
    }
    const stopGrant = onGoogleGrantInvalidated(() => { if (!grant.isCurrent()) abort() })
    const stopLocal = onLocalDataInvalidated(() => { try { assertCurrent() } catch { abort() } })
    documentWorkspaceSignal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 35000)
    dispose = () => { abort(); clearTimeout(timer); stopGrant(); stopLocal(); documentWorkspaceSignal.removeEventListener('abort', abort) }
    assertCurrent()
    finishWork = beginConversationWork(conv.id); inFlight = true
    const token = await waitForMemory(grant.getAccessToken(), lifetime.signal)
    assertCurrent()
    if (!token) return

    await waitForMemory(bootstrapLocalMemory(), lifetime.signal); assertCurrent()
    const existing = getAllFacts().map(f => ({ ...f }))
    const sentFacts = projectExtractionFacts(existing)
    // A replacement cannot target a fact omitted or only partially transmitted.
    const replaceable = existing.filter(f => sentFacts.some(sent => sent.id === f.id && sent.content === f.content))
    await waitForMemory(scope.validateReadOnly(), lifetime.signal); assertCurrent()
    // Reserve this prefix before dispatch. This records an ATTEMPT, never an
    // extraction success. It also covers lost HTTP/JSON responses after billing.
    setProgress(conv.id, userMessages.length); assertCurrent()
    const res = await waitForMemory(fetch(apiUrl('/api/ai/memory-extract'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-google-token': token,
      },
      body: JSON.stringify({
        transcript: buildTranscript(fresh),
        facts: sentFacts,
      }),
      signal: lifetime.signal, redirect: 'error', cache: 'no-store',
    }), lifetime.signal)
    assertCurrent()

    const data = res.ok ? (await waitForMemory(res.json(), lifetime.signal)) as Partial<ExtractionResult> : null
    await waitForMemory(scope.validateReadOnly(), lifetime.signal); assertCurrent()
    if (!data) return
    const result: ExtractionResult = {
      add: Array.isArray(data.add) ? data.add.filter((a) => typeof a?.fact === 'string') : [],
      replace: Array.isArray(data.replace)
        ? data.replace.filter((r) => typeof r?.id === 'string' && typeof r?.fact === 'string')
        : [],
    }
    const changes = await waitForMemory(applyExtraction(result, replaceable, assertCurrent), lifetime.signal)
    assertCurrent()
    if (changes > 0) {
      // Transparence (stratégie confiance) : jamais de mémorisation invisible.
      try { toast(i18n.t('settings.autoMemory.updated'), 'info') } catch { /* tests */ }
    }
  } catch {
    // Silencieux par design — la mémoire auto ne doit jamais perturber le chat.
  } finally {
    dispose()
    if (finishWork) { finishWork(); inFlight = false }
  }
}
