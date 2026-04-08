import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const tunnelUrl = process.env.TUNNEL_URL
  const tunnelSecret = process.env.TUNNEL_SECRET

  if (!tunnelUrl || !tunnelSecret) {
    return res.status(500).json({ error: 'Tunnel not configured (TUNNEL_URL, TUNNEL_SECRET)' })
  }

  const { action, params } = req.body as {
    action?: string
    params?: Record<string, unknown>
  }

  if (!action) {
    return res.status(400).json({ error: 'Missing action' })
  }

  try {
    // Check if PC is reachable
    const healthCheck = await fetch(`${tunnelUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (!healthCheck?.ok) {
      return res.status(503).json({
        error: 'PC non joignable. Vérifiez que start-all.bat est lancé et le tunnel actif.',
      })
    }

    // Relay the action to the local server
    const response = await fetch(`${tunnelUrl}/computer/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tunnel-secret': tunnelSecret,
      },
      body: JSON.stringify({ action, params }),
      signal: AbortSignal.timeout(25000),
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(response.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Relay failed'
    if (message.includes('timeout') || message.includes('abort')) {
      return res.status(504).json({ error: 'Timeout — le PC met trop de temps à répondre' })
    }
    return res.status(500).json({ error: message })
  }
}
