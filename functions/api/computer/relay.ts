import type { Env } from '../../env'
import { verifyGoogleIdentityStrict } from '../_lib/checkAllowedUser'

const NOT_FOUND = { error: 'Not found' }
const NOT_FOUND_STATUS = 404

// C13 — défense en profondeur : n'accepter que les actions réellement émises par
// le client (type ComputerAction). Le serveur local est déjà durci (commit
// 125dcd1) ; cette allowlist empêche de relayer une action arbitraire même si
// l'auth owner était un jour contournée.
const ALLOWED_ACTIONS = new Set(['screenshot', 'open_app', 'click', 'type', 'scroll', 'key'])

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Feature flag — endpoint is hidden entirely unless explicitly enabled.
  if (env.COMPUTER_RELAY_ENABLED !== 'true') {
    return Response.json(NOT_FOUND, { status: NOT_FOUND_STATUS })
  }

  // Config sanity — if any piece is missing, pretend the endpoint does not exist.
  if (!env.GOOGLE_CLIENT_ID || !env.COMPUTER_RELAY_OWNER_SUB || !env.TUNNEL_URL || !env.TUNNEL_SECRET) {
    return Response.json(NOT_FOUND, { status: NOT_FOUND_STATUS })
  }

  // Auth: require a Google token whose sub matches the configured owner.
  const identity = await verifyGoogleIdentityStrict(request, env.GOOGLE_CLIENT_ID)
  if (!identity?.sub || identity.sub !== env.COMPUTER_RELAY_OWNER_SUB) {
    return Response.json(NOT_FOUND, { status: NOT_FOUND_STATUS })
  }

  const { action, params } = await request.json() as { action?: string; params?: Record<string, unknown> }

  if (!action) {
    return Response.json({ error: 'Missing action' }, { status: 400 })
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
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
