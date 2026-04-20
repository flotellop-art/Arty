import type { Env } from '../../env'
import { checkAllowedUser, verifyGoogleUser } from '../_lib/checkAllowedUser'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Anti-relais anonyme : tout appel doit venir d'un user Google authentifié,
  // même en BYOK. Empêche l'utilisation du proxy Cloudflare comme relais
  // ouvert par n'importe qui sur Internet (CRIT-4).
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK prioritaire — si le client envoie sa propre clé, on l'utilise
  // telle quelle (chaque user paie ses propres appels).
  let apiKey = request.headers.get('x-api-key')

  // Pas de BYOK → fallback sur la clé serveur si et seulement si l'email
  // est dans `ALLOWED_EMAILS`. Sinon 401.
  if (!apiKey && env.ANTHROPIC_API_KEY) {
    const allowedEmail = await checkAllowedUser(request, env)
    if (allowedEmail) {
      apiKey = env.ANTHROPIC_API_KEY
    }
  }

  if (!apiKey) {
    // Report the exact reason so admins can diagnose whitelist mismatches
    // (typo, Gmail dot variant, wrong env scope). We leak the caller's own
    // email back to them — not sensitive, they already know it.
    const allowlistConfigured = !!env.ALLOWED_EMAILS
    const message = !allowlistConfigured
      ? "Clé API requise — whitelist ALLOWED_EMAILS non configurée côté serveur."
      : `Clé API requise — l'email ${email} n'est pas dans la whitelist. Contactez l'admin.`
    return Response.json(
      { error: message, email },
      { status: 401 }
    )
  }

  const body = await request.text()

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
  }

  const beta = request.headers.get('anthropic-beta')
  if (beta) {
    headers['anthropic-beta'] = beta
  }

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
      body,
    })

    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') || 'text/event-stream',
        'cache-control': 'no-cache',
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 502 }
    )
  }
}
