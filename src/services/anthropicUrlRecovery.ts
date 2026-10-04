import { extractAllHttpUrls, extractWebUrls } from './aiRouter'
import { fetchUrlMarkdowns, TOOL_FETCH_TIMEOUT_MS } from './pdfUrlFetch'
import { urlAllowlistKey } from './tools/fetchUrlTool'
import { markUntrustedThirdPartyData } from './tools/untrustedContent'
import type { SearchContextSource } from './factChecker'

// One recovery pass per user turn, including when Claude never tried to read.
export const MAX_URL_RECOVERIES = 3
const RECOVERABLE_ERRORS = new Set(['url_not_accessible', 'unavailable'])

export const URL_READING_RULES = `
LECTURE DES LIENS FOURNIS : une recherche ou un témoignage sur une autre page
ne remplace pas le contenu du lien demandé. Analyse seulement le contenu
effectivement récupéré pour ce lien et cite son URL. Distingue les déclarations
de l'auteur des faits établis. Un échec de lecture ou de recherche ne prouve
ni un blocage du site, ni un paywall, ni une absence d'indexation.`

type Block = { type: string; [key: string]: unknown }
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function hasReadableContent(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const content = value.replace(/^--- CONTENU DE LA PAGE[^\n]*\n/, '').trim()
  return !!content && !/^(?:#{1,6}\s*)?(?:You['’]ve been blocked by network security|Access denied|Just a moment|Checking your browser)(?:[.!…\s]|$)/i.test(content)
}

export function requestedWebUrls(text: string): string[] {
  const candidates = extractWebUrls(text)
  const remainder = extractAllHttpUrls(text).reduce((rest, url) => rest.split(url).join(''), text)
  const asksToRead = /^[\s.,!?;:]*$/.test(remainder) ||
    /\b(?:lis|lire|lecture|ouvre|ouvrir|résum(?:e|é|er)|analys(?:e|er)|vérifi(?:e|er)|regarde|consulte|contenu|article|publication|post|read|open|summari[sz]e|summary|analy[sz]e|review)(?=\s|[.,:!?]|$)/i.test(remainder)
  if (!asksToRead) return []
  const urls = new Map<string, string>()
  for (const url of candidates) {
    const key = urlAllowlistKey(url)
    if (key && !urls.has(key)) urls.set(key, url)
  }
  return [...urls.values()]
}

/** Inspect structured native results only; prose and neighbouring search hits
 * cannot attest that a requested page was read. Never mutate signed blocks. */
export function inspectRequestedUrlReads(urls: string[], blocks: Block[]) {
  const calls = new Map<string, string>()
  const read = new Set<string>()
  const denied = new Set<string>()
  for (const block of blocks) {
    if (block.type !== 'server_tool_use' || block.name !== 'web_fetch') continue
    const url = record(block.input)?.url
    const key = typeof url === 'string' ? urlAllowlistKey(url) : null
    if (typeof block.id === 'string' && key) calls.set(block.id, key)
  }
  for (const block of blocks) {
    if (block.type !== 'web_fetch_tool_result') continue
    const key = calls.get(String(block.tool_use_id))
    const content = record(block.content)
    if (!key || !content) continue
    if (content.type === 'web_fetch_result') {
      const source = record(record(content.content)?.source)
      const resultKey = typeof content.url === 'string' ? urlAllowlistKey(content.url) : null
      if (resultKey === key && source && [source.data, source.text].some(hasReadableContent)) read.add(key)
    } else if (content.type === 'web_fetch_tool_result_error' && !RECOVERABLE_ERRORS.has(String(content.error_code))) {
      // Includes organisation/robots.txt restrictions and provider rate caps.
      // An alternative reader must not circumvent an explicit refusal.
      denied.add(key)
    }
  }
  return {
    unread: urls.filter(url => !read.has(urlAllowlistKey(url)!)),
    denied,
  }
}

export async function recoverRequestedUrls(
  urls: string[],
  denied: Set<string>,
  signal: AbortSignal,
  assertCurrent?: () => void,
): Promise<{ context: string; unread: string[]; sources: SearchContextSource[] }> {
  const guard = () => { signal.throwIfAborted(); assertCurrent?.() }
  guard()
  let attempts = 0
  const results = await Promise.all(urls.map(async url => {
    const key = urlAllowlistKey(url)
    if (!key || denied.has(key) || attempts >= MAX_URL_RECOVERIES) return { url, block: null }
    attempts++
    guard()
    let block: string | null = null
    const readController = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      // Only the requested URL is forwarded: never a model-generated URL,
      // query parameter, session cookie or URL discovered inside page content.
      block = await Promise.race([
        fetchUrlMarkdowns([url], readController.signal).then(result => result.block),
        new Promise<null>(resolve => {
          onAbort = () => { readController.abort(signal.reason); resolve(null) }
          signal.addEventListener('abort', onAbort, { once: true })
          if (signal.aborted) onAbort()
          // Bounds auth preparation as well as the underlying HTTP request.
          timer = setTimeout(() => { readController.abort(); resolve(null) }, TOOL_FETCH_TIMEOUT_MS)
        }),
      ])
      if (!hasReadableContent(block)) block = null
    } catch {
      // Auth/network errors remain an unavailable read, never a site diagnosis.
    } finally {
      clearTimeout(timer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
    guard() // fetchOne deliberately absorbs AbortError; Stop still wins here.
    return { url, block }
  }))
  guard()
  const read = results.filter((r): r is { url: string; block: string } => !!r.block?.trim())
  return {
    context: read.length ? [
      'Le lecteur alternatif a récupéré les contenus ci-dessous pour les URL demandées. Réponds maintenant à la demande initiale sans nouvel appel d’outil. Ignore ta réponse provisoire. Une extraction peut être partielle : indique ce qui manque, et ne remplace pas le post par un autre témoignage.',
      ...read.map(r => markUntrustedThirdPartyData('Page web', r.block)),
    ].join('\n\n') : '',
    unread: results.filter(r => !r.block?.trim()).map(r => r.url),
    // Available to the fact-checker, without claiming verified facts or a
    // provider citation linking this source to the final answer.
    sources: read.map(r => ({ title: new URL(r.url).hostname, url: r.url, snippet: r.block })),
  }
}
