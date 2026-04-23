import type { Env } from '../../env'
import { parseAllowedEmails, verifyGoogleUser } from '../_lib/checkAllowedUser'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { createAnthropicParser, teeForParsing } from '../_lib/trackUsage'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
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
  // telle quelle (chaque user paie ses propres appels, donc pas de quota).
  let apiKey = request.headers.get('x-api-key')
  const isByok = !!apiKey

  // Pas de BYOK → fallback sur la clé serveur si et seulement si l'email
  // est dans `ALLOWED_EMAILS` ET `ANTHROPIC_API_KEY` est configurée.
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  const isWhitelisted = allowed.includes(email)
  const hasServerKey = !!env.ANTHROPIC_API_KEY
  if (!apiKey && hasServerKey && isWhitelisted) {
    apiKey = env.ANTHROPIC_API_KEY
  }

  if (!apiKey) {
    let message: string
    if (!env.ALLOWED_EMAILS) {
      message = "Clé API requise — whitelist ALLOWED_EMAILS non configurée côté serveur."
    } else if (!hasServerKey) {
      message = `Clé API requise — ANTHROPIC_API_KEY non configurée côté serveur (email ${email} est ${isWhitelisted ? '' : 'absent de la '}whitelist${isWhitelisted ? ' ✔' : ''}).`
    } else if (!isWhitelisted) {
      const rawLength = env.ALLOWED_EMAILS.length
      const preview = allowed.map((e) => e.slice(0, 3) + '…').join(', ')
      message = `Clé API requise — l'email ${email} n'est pas dans la whitelist (${allowed.length} emails parsés: [${preview}], ${rawLength} chars raw). Contactez l'admin.`
    } else {
      message = "Clé API requise — configuration serveur incomplète."
    }
    return Response.json(
      {
        error: message,
        email,
        isWhitelisted,
        hasServerKey,
        parsedCount: allowed.length,
        rawLength: env.ALLOWED_EMAILS ? env.ALLOWED_EMAILS.length : 0,
      },
      { status: 401 }
    )
  }

  const body = await request.text()

  // Extract the model name from the body so the quota breakdown in Settings
  // knows which model was called. Defaults to 'claude' if parsing fails —
  // the quota still works, we just lose granularity for that call.
  let modelName = 'claude'
  try {
    const parsed = JSON.parse(body) as { model?: unknown }
    if (typeof parsed.model === 'string' && parsed.model.length > 0) {
      modelName = parsed.model
    }
  } catch {
    // Leave fallback.
  }

  // Cap server-key usage per user per day. BYOK callers pay their own Anthropic
  // bill and are not counted here. Protects against a stolen Google token
  // burning through ANTHROPIC_API_KEY spend unchecked.
  if (!isByok) {
    const quota = await consumeDailyQuota(env, email, modelName)
    if (!quota.allowed) {
      return Response.json(
        {
          error: `Quota journalier atteint (${quota.count}/${quota.limit} appels aujourd'hui). Réessayez demain ou configurez votre propre clé API dans les paramètres.`,
          count: quota.count,
          limit: quota.limit,
        },
        { status: 429 }
      )
    }
  }

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

    // Ne track que les appels server-key réussis (BYOK = user paie lui-même).
    if (!isByok && response.ok && response.body) {
      const parser = createAnthropicParser()
      const { clientBody, parsedUsage } = teeForParsing(
        response.body,
        parser.feed,
        parser.finalize
      )
      waitUntil(parsedUsage.then((usage) => recordUsage(env, email, modelName, usage)))
      return new Response(clientBody, {
        status: response.status,
        headers: {
          'content-type': response.headers.get('content-type') || 'text/event-stream',
          'cache-control': 'no-cache',
        },
      })
    }

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
