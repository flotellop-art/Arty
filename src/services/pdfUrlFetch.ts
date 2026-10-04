// Client pour /api/fetch/url : convertit une URL de PDF public en Markdown
// (via Linkup côté serveur). Utilisé par useConversation quand l'utilisateur
// colle un lien .pdf — Claude `web_fetch` ne lit pas les PDF binaires.
//
// Tolérant aux échecs : si un fetch rate (PDF mort, Linkup down, trop gros),
// on l'ignore silencieusement et on laisse le message partir tel quel — Claude
// tentera son web_fetch natif. Jamais d'erreur bloquante côté UI.

import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'

// Cap dur : un message ne déclenche au plus que ce nombre de fetch PDF, pour
// éviter d'épuiser le quota Linkup (clé serveur du owner) si quelqu'un colle
// 20 liens d'un coup.
const MAX_PDFS_PER_MESSAGE = 3

// Distingue « page illisible » (paywall / vide → 502) d'une vraie panne pour
// que l'appelant puisse expliquer honnêtement à l'utilisateur (bug live
// 11 juin : Figaro paywall → échec silencieux → Mistral disait « je ne peux
// pas lire » sans dire pourquoi).
interface PageReceipt {
  provider: string
  finalUrl?: string
  retrievedAt?: string
  access?: string
  imagesIncluded?: boolean
  commentsIncluded?: boolean | null
  truncated?: boolean
}
type FetchOutcome =
  | { ok: true; url: string; markdown: string; provider?: string; receipt?: PageReceipt }
  | { ok: false; url: string; reason: 'unreadable' | 'error' }

// Timeouts (10 août 2026) — ce fetch n'en avait AUCUN. Tolérable tant qu'il
// n'était qu'une étape de pré-traitement ; inacceptable depuis que le tool
// `fetch_url` le rend invocable en boucle par le modèle : un cold-start
// Linkup laissait la boucle pendue sans erreur ni feedback UI.
const DEFAULT_FETCH_TIMEOUT_MS = 60_000
export const TOOL_FETCH_TIMEOUT_MS = 30_000

async function fetchOne(
  url: string,
  token: string | null,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  readerPolicy: 'eu-only' | 'public-browser' = 'public-browser',
): Promise<FetchOutcome> {
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), timeoutMs)
  const onExternalAbort = () => ctrl.abort(externalSignal?.reason ?? new DOMException('Aborted', 'AbortError'))
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['x-google-token'] = token
    // apiUrl() : sur l'APK natif l'origin WebView est https://localhost — un
    // chemin relatif taperait localhost. Tous les autres clients passent par
    // apiUrl ; pdfUrlFetch était le seul oublié (bug latent natif).
    const res = await fetch(apiUrl('/api/fetch/url'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, readerPolicy }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      // 502 = texte demandé non obtenu, sans cause présumée ; le reste
      // (401, 503, 5xx réseau) = panne technique.
      return { ok: false, url, reason: res.status === 502 ? 'unreadable' : 'error' }
    }
    const data = (await res.json()) as { markdown?: string; provider?: string; receipt?: PageReceipt }
    if (!data.markdown) return { ok: false, url, reason: 'unreadable' }
    return { ok: true, url, markdown: data.markdown, provider: data.provider, receipt: data.receipt }
  } catch {
    return { ok: false, url, reason: 'error' }
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Récupère le Markdown de chaque URL PDF et renvoie un bloc texte prêt à
 * injecter dans le message envoyé au LLM, ou `null` si rien n'a pu être lu.
 */
export async function fetchPdfMarkdowns(urls: string[]): Promise<string | null> {
  if (!urls.length) return null
  const token = await getValidAccessToken()
  const picked = urls.slice(0, MAX_PDFS_PER_MESSAGE)
  const results = await Promise.all(picked.map((u) => fetchOne(u, token, DEFAULT_FETCH_TIMEOUT_MS)))
  const ok = results.filter((r): r is { ok: true; url: string; markdown: string } => r.ok)
  if (!ok.length) return null
  return ok
    .map((r) => `--- CONTENU DU PDF (${r.url}) ---\n${r.markdown}\n--- FIN DU PDF ---`)
    .join('\n\n')
}

// Lot C (audit Mistral, juin 2026) — pages web pour les conversations euOnly.
// Une page d'article peut être très longue : on borne chaque page côté client
// pour ne pas noyer le contexte Mistral (les PDF gardent le cap serveur seul,
// un PDF métier mérite d'entrer entier).
const MAX_PAGE_CHARS = 12_000

export interface UrlFetchResult {
  /** Bloc à inliner dans le message, ou null si aucune page lue. */
  block: string | null
  /** URLs qui ont échoué pour cause de paywall / contenu illisible. */
  unreadable: string[]
}

/**
 * Récupère le texte des pages via le lecteur choisi côté serveur. Utilisé pour
 * les conversations euOnly : Mistral n'a aucune lecture d'URL — sans ce
 * fetch, un lien collé partait dans le vide (hallucinations PR #162).
 * Retourne le bloc à inliner ET la liste des URLs illisibles (paywall) pour
 * que l'appelant explique honnêtement l'échec au lieu d'un silence.
 */
export async function fetchUrlMarkdowns(
  urls: string[],
  signal?: AbortSignal,
  readerPolicy?: 'eu-only',
): Promise<UrlFetchResult> {
  if (!urls.length) return { block: null, unreadable: [] }
  const token = await getValidAccessToken()
  const picked = urls.slice(0, MAX_PDFS_PER_MESSAGE)
  const results = await Promise.all(
    picked.map((u) => fetchOne(u, token, TOOL_FETCH_TIMEOUT_MS, signal, readerPolicy)),
  )
  const ok = results.filter((r): r is Extract<FetchOutcome, { ok: true }> => r.ok)
  const unreadable = results.filter((r) => !r.ok && r.reason === 'unreadable').map((r) => r.url)
  const block = ok.length
    ? ok
        .map((r) => {
          const md = r.markdown.length > MAX_PAGE_CHARS
            ? r.markdown.slice(0, MAX_PAGE_CHARS) + '\n[… contenu tronqué]'
            : r.markdown
          const source = r.receipt?.provider === 'arty-browser' ? 'navigateur Arty' : r.provider === 'linkup' ? 'Linkup' : 'lecteur web'
          const limits = r.receipt ? `\nLecture : ${r.receipt.access ?? 'inconnue'} ; texte visible ; images non analysées ; commentaires ${r.receipt.commentsIncluded === false ? 'non lus' : 'non garantis'} ; URL finale : ${r.receipt.finalUrl ?? 'inconnue'} ; date : ${r.receipt.retrievedAt ?? 'inconnue'}${r.receipt.truncated ? ' ; contenu tronqué' : ''}.` : ''
          return `--- CONTENU DE LA PAGE (${r.url}) — récupéré via ${source} ---${limits}\n${md}\n--- FIN DE LA PAGE ---`
        })
        .join('\n\n')
    : null
  return { block, unreadable }
}
