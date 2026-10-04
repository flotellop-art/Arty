import { profileFor, profilesFromConfig } from './policy'
import { readWithBrowser, type ReaderBrowserBinding } from './read'
import { readRequestTextWithLimit } from '../../../functions/api/_lib/boundedRequestBody'
export { ReaderAdmission } from './admission'

export interface ReaderEnv { BROWSER: ReaderBrowserBinding; ADMISSION: DurableObjectNamespace; READER_PROFILES: string }
async function serve(request: Request, env: ReaderEnv, ctx: ExecutionContext): Promise<Response> {
    // No public route. Only trusted service binding callers supply the identity hash.
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    if (new URL(request.url).pathname === '/reconcile') {
      const admission = env.ADMISSION.get(env.ADMISSION.idFromName('global-v1'))
      try {
        const snapshot = await admission.fetch('https://admission.internal/', {
          method: 'POST', body: JSON.stringify({ inspect: true }), signal: AbortSignal.timeout(2_000),
        })
        const { leases } = await snapshot.json() as { leases: Record<string, { sessionId?: string }> }
        let released = 0, retained = 0
        for (const [lease, entry] of Object.entries(leases)) {
          if (entry.sessionId && await env.BROWSER.getSession(entry.sessionId) === null) {
            const result = await admission.fetch('https://admission.internal/', {
              method: 'POST', body: JSON.stringify({ release: lease }), signal: AbortSignal.timeout(2_000),
            })
            if (!result.ok) throw new Error('reconciliation_unavailable')
            released++
          } else retained++
        }
        return Response.json({ released, retained })
      } catch { return Response.json({ error: 'reconciliation_unavailable' }, { status: 503 }) }
    }
    let body: { url?: unknown; subject?: unknown }
    try {
      const text = await readRequestTextWithLimit(request, 4096)
      body = JSON.parse(text)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body')
    } catch { return new Response(null, { status: 400 }) }
    if (typeof body.url !== 'string' || body.url.length > 2048
      || typeof body.subject !== 'string' || !/^[a-f0-9]{64}$/.test(body.subject)) return new Response(null, { status: 400 })
    let profile, url: URL
    try { url = new URL(body.url); profile = profileFor(url, profilesFromConfig(env.READER_PROFILES)) }
    catch { return Response.json({ status: 'unavailable' }, { status: 503 }) }
    if (!profile) return Response.json({ status: 'unsupported' })
    const admission = env.ADMISSION.get(env.ADMISSION.idFromName('global-v1'))
    let lease: string
    try {
      const response = await admission.fetch('https://admission.internal/', {
        method: 'POST', body: JSON.stringify({ subject: body.subject }), signal: AbortSignal.timeout(2_000),
      })
      const result = await response.json() as { allowed?: boolean; lease?: string }
      if (!response.ok || result.allowed !== true || !result.lease) {
        return Response.json({ status: 'unavailable', reason: response.status === 429 ? 'limit' : 'admission' }, { status: response.status === 429 ? 429 : 503 })
      }
      lease = result.lease
    } catch { return Response.json({ status: 'unavailable' }, { status: 503 }) }
    const { result, completion } = await readWithBrowser(env.BROWSER, url.toString(), profile, request.signal, undefined, async sessionId => {
      const response = await admission.fetch('https://admission.internal/', {
        method: 'POST', body: JSON.stringify({ attach: lease, sessionId }), signal: AbortSignal.timeout(2_000),
      })
      if (!response.ok) throw new Error('session_tracking_unavailable')
    })
    ctx.waitUntil(completion.then(async confirmed => {
      if (confirmed) await admission.fetch('https://admission.internal/', {
        method: 'POST', body: JSON.stringify({ release: lease }), signal: AbortSignal.timeout(2_000),
      })
    }).catch(() => undefined))
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
export default {
  fetch(request: Request, env: ReaderEnv, ctx: ExecutionContext): Promise<Response> {
    const operation = serve(request, env, ctx)
    // Register BEFORE awaiting body/admission/acquisition: client disconnect
    // must not end an invocation which owns a pending remote acquisition.
    ctx.waitUntil(operation.then(() => undefined).catch(() => undefined))
    return operation
  },
} satisfies ExportedHandler<ReaderEnv>
