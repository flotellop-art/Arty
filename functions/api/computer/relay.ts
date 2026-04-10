import type { Env } from '../../env'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.TUNNEL_URL || !env.TUNNEL_SECRET) {
    return Response.json({ error: 'Tunnel not configured (TUNNEL_URL, TUNNEL_SECRET)' }, { status: 500 })
  }

  const { action, params } = await request.json() as { action?: string; params?: Record<string, unknown> }

  if (!action) {
    return Response.json({ error: 'Missing action' }, { status: 400 })
  }

  try {
    // Check if PC is reachable
    const healthCheck = await fetch(`${env.TUNNEL_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (!healthCheck?.ok) {
      return Response.json({
        error: 'PC non joignable. Vérifiez que start-all.bat est lancé et le tunnel actif.',
      }, { status: 503 })
    }

    // Relay the action to the local server
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
      return Response.json({ error: 'Timeout — le PC met trop de temps à répondre' }, { status: 504 })
    }
    return Response.json({ error: message }, { status: 500 })
  }
}
