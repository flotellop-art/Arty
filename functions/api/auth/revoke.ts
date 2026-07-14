import { revokeGoogleGrant } from '../_lib/publicGoogleScopes'
import { isAllowedOrigin } from '../_middleware'

/** Same-origin revocation bridge. Google's revocation endpoint has no CORS. */
export const onRequestPost: PagesFunction = async ({ request }) => {
  const contentType = request.headers.get('content-type') || ''
  const origin = request.headers.get('origin') || ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'Content-Type must be application/json' }, { status: 415 })
  }
  if (!isAllowedOrigin(origin)) {
    return Response.json({ error: 'Forbidden — invalid origin' }, { status: 403 })
  }
  let token: unknown
  try {
    ;({ token } = await request.json() as { token?: unknown })
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof token !== 'string' || !token.trim() || token.length > 8_192) {
    return Response.json({ error: 'Missing token' }, { status: 400 })
  }

  const revoked = await revokeGoogleGrant(token)
  return revoked
    ? new Response(null, { status: 204 })
    : Response.json({ error: 'Google revocation failed' }, { status: 502 })
}
