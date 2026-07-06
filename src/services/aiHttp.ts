import { getValidAccessToken } from './googleAuth'
import { getTrialToken } from './emailTrialClient'

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
    else externalSignal.addEventListener('abort', onExternalAbort)
  }
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timeoutId)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}
