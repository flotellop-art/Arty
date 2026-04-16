import type { Env } from '../../env'

const NOT_FOUND = { error: 'Not found' }
const NOT_FOUND_STATUS = 404

/**
 * Verify a Google access token and return its `sub` (stable account id).
 * Returns null if the token is missing, invalid, or Google rejects it.
 */
async function verifyGoogleSub(token: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { id?: string }
    return data.id || null
  } catch {
    return null
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Feature flag — endpoint is hidden entirely unless explicitly enabled.
  if (env.COMPUTER_RELAY_ENABLED !== 'true') {
    return Response.json(NOT_FOUND, { status: NOT_FOUND_STATUS })
  }

  // Config sanity — if any piece is missing, pretend the endpoint does not exist.
  if (!env.COMPUTER_RELAY_OWNER_SUB || !env.TUNNEL_URL || !env.TUNNEL_SECRET) {
    return Response.json(NOT_FOUND, { status: NOT_FOUND_STATUS })
  }

  // Auth: require a Google token whose sub matches the configured owner.
  const googleToken = request.headers.get('x-google-token')
  if (!googleToken) {
    return Response.json(NOT_FOUND, { status: NOT_FOUND_STATUS })
  }
  const sub = await verifyGoogleSub(googleToken)
  if (!sub || sub !== env.COMPUTER_RELAY_OWNER_SUB) {
    return Response.json(NOT_FOUND, { status: NOT_FOUND_STATUS })
  }

  const { action, params } = await request.json() as { action?: string; params?: Record<string, unknown> }

  if (!action) {
    return Response.json({ error: 'Missing action' }, { status: 400 })
  }

  try {
    // Check if the local relay is reachable.
    const healthCheck = await fetch(`${env.TUNNEL_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (!healthCheck?.ok) {
      // Generic — do not disclose tunnel/PC details even to the owner, since
      // any info leakage here becomes useful to an attacker if auth is ever
      // bypassed in the future.
      return Response.json({ error: 'Relay unavailable' }, { status: 503 })
    }

    const response = await fetch(`${env.TUNNEL_URL}/computer/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tunnel-secret': env.TUNNEL_SECRET,
      },
      body: JSON.stringify({ action, params }),
      signal: AbortSignal.timeout(25000),
    })

    const data = await response.json()

    if (!response.ok) {
      return Response.json(data, { status: response.status })
    }

    return Response.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Relay failed'
    if (message.includes('timeout') || message.includes('abort')) {
      return Response.json({ error: 'Relay timeout' }, { status: 504 })
    }
    return Response.json({ error: 'Relay failed' }, { status: 500 })
  }
}
