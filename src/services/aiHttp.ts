import { getValidAccessToken } from './googleAuth'
import { getTrialToken } from './emailTrialClient'
import i18n from '../i18n'

// ─────────────────────────────────────────────────────────────────────
// Helper HTTP commun aux clients IA (C9 / F-20)
//
// Les 4 clients (anthropic/mistral/gemini/openai) réimplémentaient le MÊME
// trio — d'où des régressions répétées (BUG 23 : token Google non rafraîchi ;
// BUG 25 : clé sentinelle 'server-provided' envoyée comme vraie clé). Factorisé
// ici en une source unique.
//
// ⚠️ Hors périmètre volontaire : le parsing SSE reste par-client (3 formats
// incompatibles ; Anthropic interdit de filtrer les blocs vides — BUG 52).
// ─────────────────────────────────────────────────────────────────────

export interface AiHeaderOptions {
  /**
   * Clé BYOK de l'utilisateur. La sentinelle 'server-provided' (comme null/'')
   * signifie « pas de clé cliente → le proxy utilise la clé serveur » : elle ne
   * doit JAMAIS partir comme vraie clé (BUG 25).
   */
  byokKey?: string | null
  /** Transport de la clé BYOK : 'bearer' (Authorization) par défaut, ou 'x-api-key' (Anthropic). */
  auth?: 'bearer' | 'x-api-key'
  /** En-têtes spécifiques au provider (ex. anthropic-version/-beta). Fusionnés en premier. */
  extra?: Record<string, string>
}

/**
 * Construit les en-têtes d'une requête vers un proxy IA :
 *  - Content-Type JSON (+ `extra` provider) ;
 *  - clé BYOK si réelle (garde 'server-provided', BUG 25) ;
 *  - `x-google-token` frais via getValidAccessToken() (BUG 23), sinon repli
 *    `x-arty-trial-token` (essai email).
 */
export async function buildAiHeaders(opts: AiHeaderOptions = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.extra ?? {}) }

  const key = opts.byokKey
  if (key && key !== 'server-provided') {
    if (opts.auth === 'x-api-key') headers['x-api-key'] = key
    else headers['Authorization'] = `Bearer ${key}`
  }

  const googleToken = await getValidAccessToken()
  if (googleToken) {
    headers['x-google-token'] = googleToken
  } else {
    const trialToken = getTrialToken()
    if (trialToken) headers['x-arty-trial-token'] = trialToken
  }
  return headers
}

/**
 * fetch borné par un timeout (AbortController) et composable avec un signal
 * externe (annulation utilisateur). Le timeout est nettoyé dès que la réponse
 * arrive → il ne coupe PAS la lecture du stream ensuite. Extrait tel quel de
 * geminiClient (implémentation éprouvée).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  const onExternalAbort = () => ctrl.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason)
    // `once` : le listener se détache seul quand le signal fire. On ne le
    // détache PAS à l'arrivée des headers (l'ancien `removeEventListener` en
    // finally) : le fetch entier — body streamé compris — est piloté par
    // ctrl.signal, et retirer le lien externe dès les headers rendait le
    // Stop utilisateur inopérant pendant toute la lecture du stream
    // (audit 14 juillet 2026). Coût accepté : dans un tour multi-outils avec
    // retries (Mistral : jusqu'à 20 itérations × 3 tentatives 429), plusieurs
    // dizaines de listeners {once} peuvent s'empiler sur le MÊME signal
    // par-message — sans effet (abort() sur un ctrl dont le fetch est fini
    // est un no-op) et tout est GC-able à la fin du message.
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    // Échec avant les headers : plus aucun body à piloter, on nettoie.
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lecture de stream bornée par un watchdog d'inactivité (bug live du
// 14 juillet 2026 — « Arty écrit… » éternel). Les 4 clients IA lisaient le
// body via `reader.read()` sans AUCUNE borne : sur une connexion mobile
// half-open (morte sans RST), la lecture pendait pour toujours → ni onDone
// ni onError → stream fantôme. Même classe que BUG 47 (« jamais d'attente
// réseau non bornée »).
//
// Les API SSE émettent des octets en continu pendant toute la génération
// (deltas, keep-alive/ping pendant les pauses serveur) : un silence total de
// 90 s n'est jamais légitime. NE PAS remplacer par un AbortSignal.timeout sur
// le fetch : ce serait un plafond sur la durée TOTALE du stream, qui
// abattrait les longues générations légitimes.
// ─────────────────────────────────────────────────────────────────────
export const STREAM_INACTIVITY_TIMEOUT_MS = 90_000

/**
 * Un `reader.read()` qui rejette après `timeoutMs` sans octet reçu.
 * Rejette avec une Error ORDINAIRE — surtout pas un AbortError : plusieurs
 * clients traitent AbortError comme un Stop utilisateur (silencieux ou
 * onDone) ; un timeout déguisé en abort ne déclencherait jamais onError et
 * reproduirait le spinner éternel. L'appelant DOIT `reader.cancel()` dans son
 * finally : après un timeout, le read() d'origine reste pendant — cancel le
 * résout et libère la socket.
 */
export async function readWithInactivityTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number = STREAM_INACTIVITY_TIMEOUT_MS
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(i18n.t('errors.streamStalled'))), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
