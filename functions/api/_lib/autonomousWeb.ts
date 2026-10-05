import type { Env } from '../../env'

export const isAutonomousWeb = (env: Env): boolean => env.SEARCH_PROVIDER === 'arty-index'
export class AutonomousWebError extends Error {
  constructor(public readonly code: 'index_unavailable' | 'not_in_index' | 'eu_backend_unconfirmed') { super(code) }
}

function endpoint(env: Env, path: '/search' | '/fetch'): URL {
  if (!env.AUTONOMOUS_WEB_URL || !env.AUTONOMOUS_WEB_KEY || env.AUTONOMOUS_WEB_KEY.length < 32) throw new AutonomousWebError('index_unavailable')
  const base = new URL(env.AUTONOMOUS_WEB_URL)
  const local = env.AUTONOMOUS_WEB_LOCAL === 'true' && base.protocol === 'http:' && base.hostname === '127.0.0.1'
  if ((!local && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new AutonomousWebError('index_unavailable')
  return new URL(path, base)
}

async function call(env: Env, path: '/search' | '/fetch', body: unknown, signal?: AbortSignal): Promise<Record<string, any>> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(endpoint(env, path), { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AUTONOMOUS_WEB_KEY}` },
      body: JSON.stringify(body), signal: controller.signal })
    if (!res.ok) { await res.body?.cancel(); throw new AutonomousWebError(res.status === 404 ? 'not_in_index' : 'index_unavailable') }
    const reader = res.body?.getReader()
    if (!reader) throw new AutonomousWebError('index_unavailable')
    let text = '', bytes = 0
    const decoder = new TextDecoder()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 1_000_000) throw new AutonomousWebError('index_unavailable')
        text += decoder.decode(chunk.value, { stream: true })
      }
      const data = JSON.parse(text + decoder.decode())
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.provider !== 'arty-index') throw new AutonomousWebError('index_unavailable')
      return data
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } catch (err) {
    if (signal?.aborted) throw signal.reason
    if (err instanceof AutonomousWebError) throw err
    throw new AutonomousWebError('index_unavailable')
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}

export async function readAutonomousPage(env: Env, url: string, signal?: AbortSignal, euOnly = false) {
  const normalized = new URL(url); normalized.hash = ''; url = normalized.toString()
  if (euOnly && env.AUTONOMOUS_WEB_REGION !== 'eu') throw new AutonomousWebError('eu_backend_unconfirmed')
  const data = await call(env, '/fetch', { url }, signal)
  const receipt = data.receipt
  if (typeof data.markdown !== 'string' || data.markdown.length < 40 || data.markdown.length > 160_000 || data.truncated !== false ||
      !receipt || receipt.provider !== 'arty-index' || receipt.requestedUrl !== url || receipt.captureMode !== 'html-static' ||
      receipt.truncated !== false || typeof receipt.retrievedAt !== 'string' || !Number.isFinite(Date.parse(receipt.retrievedAt)) ||
      typeof receipt.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new AutonomousWebError('index_unavailable')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data.markdown))
  const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  if (sha !== receipt.sha256) throw new AutonomousWebError('index_unavailable')
  return data as { provider: 'arty-index'; markdown: string; truncated: false; originalLength: number; receipt: { retrievedAt: string; sha256: string; [key: string]: unknown } }
}

export async function searchAutonomous(env: Env, query: string, maxResults = 5, sources: string[] = [], verifyUrls = false, signal?: AbortSignal) {
  const data = await call(env, '/search', { query, maxResults, ...(sources.length ? { sources } : {}) }, signal)
  const check = async (items: unknown): Promise<any[]> => {
    if (!Array.isArray(items) || items.length > maxResults) throw new AutonomousWebError('index_unavailable')
    const out = []
    for (const r of items) {
      if (!r || typeof r.url !== 'string' || !/^https:\/\//.test(r.url) || typeof r.title !== 'string' || typeof r.snippet !== 'string') throw new AutonomousWebError('index_unavailable')
      const item = { title: r.title.slice(0, 300), url: r.url, snippet: r.snippet.slice(0, 1200), retrievedAt: r.retrievedAt, sha256: r.sha256, captureMode: r.captureMode }
      if (verifyUrls) {
        try { await readAutonomousPage(env, r.url, signal); out.push({ ...item, verified: true }) }
        catch (e) { if (!(e instanceof AutonomousWebError) || e.code !== 'not_in_index') throw e }
      } else out.push(item)
    }
    return out
  }
  if (sources.length) {
    const bySource: Record<string, { results: any[] }> = {}
    for (const source of sources) bySource[source] = { results: await check(data.bySource?.[source]?.results) }
    return { provider: 'arty-index', query, coverage: data.coverage, bySource }
  }
  return { provider: 'arty-index', query, coverage: data.coverage, results: await check(data.results) }
}

/** Native tools execute on provider infrastructure and bypass our search proxy.
 * Old clients are refused BEFORE model execution/debit, including BYOK. */
export function nativeWebForbidden(env: Env, body: Record<string, unknown>, provider: 'anthropic' | 'gemini'): boolean {
  if (!isAutonomousWeb(env)) return false
  if (provider === 'gemini') {
    if (body.tiktokVideoUrl !== undefined) return true
    if (Array.isArray(body.contents) && body.contents.some(c => Array.isArray(c?.parts) && c.parts.some((p: any) => {
      const uri = p?.fileData?.fileUri ?? p?.file_data?.file_uri
      return typeof uri === 'string' && !/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/files\/[a-zA-Z0-9_-]+$/.test(uri)
    }))) return true
  }
  if (!Array.isArray(body.tools)) return false
  return body.tools.some(tool => tool && typeof tool === 'object' && (provider === 'anthropic'
    ? typeof tool.type === 'string' && /^(web_search|web_fetch|code_execution|computer)_/.test(tool.type)
    : ['google_search', 'googleSearch', 'google_search_retrieval', 'googleSearchRetrieval', 'url_context', 'urlContext', 'google_maps', 'googleMaps'].some(k => k in tool)))
}
export const autonomousNativeToolResponse = () => Response.json({ error: 'autonomous_web_requires_owned_tools' }, { status: 409 })
