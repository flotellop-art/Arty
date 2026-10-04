import type { Env } from '../../env'
import { limitReadableStream } from './boundedRequestBody'

export async function fetchBrowserPage(env: Env, request: Request, url: string, email: string): Promise<Response | null> {
  if (env.URL_READER_ENABLED !== 'true') return null
  if (!env.URL_READER) return Response.json({ error: 'Fetch unavailable' }, { status: 503 })
  const controller = new AbortController()
  const abort = () => controller.abort(request.signal.reason)
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  const timer = setTimeout(() => controller.abort(), 26_000)
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
    const subject = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
    controller.signal.throwIfAborted()
    const response = await env.URL_READER.fetch('https://reader.internal/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, subject }), signal: controller.signal,
    })
    const data = JSON.parse(await new Response(response.body ? limitReadableStream(response.body, 100_000) : null).text()) as {
      status?: string; markdown?: unknown; receipt?: { provider?: string; requestedUrl?: string }
    }
    // Only a profile miss BEFORE acquisition permits the legacy reader.
    if (response.ok && data.status === 'unsupported') return null
    if (!response.ok) return Response.json({ error: 'Fetch unavailable' }, { status: response.status === 429 ? 429 : 503 })
    if (data.status !== 'read' || typeof data.markdown !== 'string' || !data.markdown.trim()
      || data.markdown.length > 12_000 || data.receipt?.provider !== 'arty-browser' || data.receipt.requestedUrl !== url) {
      return Response.json({ error: 'Page unreadable', reason: 'not_read' }, { status: 502 })
    }
    return Response.json({ markdown: data.markdown, receipt: data.receipt }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Fetch unavailable' }, { status: 503 })
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
  }
}
