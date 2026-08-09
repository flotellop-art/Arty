import { CapacitorHttp } from '@capacitor/core'
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

// ─────────────────────────────────────────────────────────────────────
// POST natif avec repli WebView (incident terrain du 9 août 2026)
//
// Sur Android, CapacitorHttp (HttpURLConnection) résout le DNS via le
// résolveur SYSTÈME (netd), distinct du résolveur interne de la WebView
// Chromium. Pendant une bascule Wi-Fi↔LTE, le résolveur système peut
// échouer (UnknownHostException « Unable to resolve host ») alors que la
// pile WebView — cache DNS propre, connexions déjà chaudes — fonctionne
// encore. Vu en prod : réponse Gemini streamée avec succès, puis
// fact-check ET récupération de liens en échec DNS trois secondes après.
//
// Stratégie : 1 tentative native, puis, UNIQUEMENT si l'exception garantit
// que la requête n'a jamais été émise (allowlist ci-dessous), 1 repli sur
// fetch WebView. Deux tentatives maximum, sur deux piles réseau
// différentes — jamais deux fois la même (retenter le résolveur qui vient
// d'échouer pendant un handoff réseau est la branche la moins prometteuse).
//
// JAMAIS de repli après une réponse HTTP reçue, ni sur une exception
// ambiguë : les endpoints appelés consomment leur quota à l'ENTRÉE
// (bg_quota, cap Sonnet 15/jour) — un repli post-émission le brûlerait
// deux fois. SocketTimeoutException couvre AUSSI des connect-timeouts sur
// Android (même classe, seul le message diffère) : exclue en bloc.
// Sur iOS le bridge ne pose pas de `code` → aucun repli (fail-safe).
// ─────────────────────────────────────────────────────────────────────

// `code` posé par le bridge Capacitor = e.getClass().getSimpleName() Java.
// Allowlist (jamais denylist) : tout code inconnu ou absent = pas de repli.
const PRE_EMISSION_ERROR_CODES = new Set([
  'UnknownHostException',
  'ConnectException',
  'NoRouteToHostException',
])

/** L'exception native garantit-elle que la requête n'a jamais atteint le serveur ? */
export function isPreEmissionNetworkError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && PRE_EMISSION_ERROR_CODES.has(code)
}

export interface NativePostBudget {
  connectTimeoutMs: number
  readTimeoutMs: number
  /**
   * Deadline ABSOLU (Date.now() + budget du palier). Le repli reçoit le
   * temps restant — le timeout n'est jamais ré-armé, le pire cas total du
   * palier ne bouge pas (le badge fact-check en dépend, STALE_PENDING_MS).
   */
  deadline: number
}

/**
 * POST JSON via CapacitorHttp, avec repli fetch WebView sur échec réseau
 * pré-émission. À n'appeler QUE sur plateforme native.
 */
export async function postJsonNativeWithFallback(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  budget: NativePostBudget,
): Promise<Response> {
  try {
    const nativeResponse = await CapacitorHttp.request({
      url,
      method: 'POST',
      // Origin exigé par le middleware Cloudflare. Injecté UNIQUEMENT sur la
      // branche native : pour fetch, Origin est un forbidden header —
      // silencieusement ignoré — et la WebView pose déjà https://localhost.
      headers: { ...headers, Origin: 'https://localhost' },
      data: payload,
      connectTimeout: budget.connectTimeoutMs,
      readTimeout: budget.readTimeoutMs,
      responseType: 'json',
    })
    const body = typeof nativeResponse.data === 'string'
      ? nativeResponse.data
      : JSON.stringify(nativeResponse.data ?? {})
    return new Response(body, {
      status: nativeResponse.status,
      headers: nativeResponse.headers,
    })
  } catch (err) {
    if (!isPreEmissionNetworkError(err)) throw err
    const remainingMs = budget.deadline - Date.now()
    if (remainingMs < 5_000) throw err
    // La tentative 2 peut, elle, pendre sur un socket half-open (raison
    // d'être du transport natif) et consommer le quota — accepté : une
    // chance de succès vaut mieux qu'un échec garanti, et le deadline borne.
    return fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, remainingMs)
  }
}
