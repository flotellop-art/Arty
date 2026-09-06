import type { Env } from '../../env'
import { readRequestTextWithLimit, RequestBodyTooLargeError } from '../_lib/boundedRequestBody'
import { verifyGoogleIdentityStrictDetailed } from '../_lib/checkAllowedUser'
import { recordProductMeasurement } from '../_lib/productMeasurement'
import { PRODUCT_MEASUREMENT_BODY_BYTES, PRODUCT_MEASUREMENT_RELEASED, parseProductMeasurement } from '../../../src/services/productMeasurementProtocol'

const reply = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })

// Google authorizes this request only; identity is never sent to the writer.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!PRODUCT_MEASUREMENT_RELEASED) return reply(404)
  if (request.method !== 'POST') return reply(405)
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415)
  try {
    const text = await readRequestTextWithLimit(request, PRODUCT_MEASUREMENT_BODY_BYTES)
    let declaration
    try { declaration = parseProductMeasurement(JSON.parse(text)) } catch { return reply(400) }
    // The first-party client sends this exact serialization. Requiring it also
    // rejects duplicate/escaped JSON keys instead of normalizing ambiguous input.
    if (!declaration || text !== JSON.stringify(declaration)) return reply(400)
    if (!env.DB) return reply(503)
    const auth = await verifyGoogleIdentityStrictDetailed(request, env.GOOGLE_CLIENT_ID)
    if (auth.status !== 'ok') return reply(auth.status === 'unauthorized' ? 401 : 503)
    if (request.signal.aborted) return reply(408)
    return reply(await recordProductMeasurement(env.DB, declaration.outcome) ? 204 : 429)
  } catch (error) {
    // Neither raw diagnostics nor an identity are echoed, logged or retried.
    return reply(error instanceof RequestBodyTooLargeError ? 413 : 503)
  }
}
