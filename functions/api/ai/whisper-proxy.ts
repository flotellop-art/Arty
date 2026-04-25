import type { Env } from '../../env'
import { checkAllowedUser, verifyGoogleUser } from '../_lib/checkAllowedUser'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { parseWhisperBody } from '../_lib/trackUsage'

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : un token Google valide est obligatoire (CRIT-4).
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK prioritaire via header dédié (distinct de x-api-key utilisé par Anthropic).
  let apiKey = request.headers.get('x-openai-key') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' = 'free'

  // Fallback clé serveur pour les utilisateurs avec un plan actif (sub/pro/vip)
  // ou la whitelist legacy en filet de secours.
  if (!apiKey && env.OPENAI_API_KEY) {
    const allowedUser = await checkAllowedUser(request, env)
    if (allowedUser) {
      apiKey = env.OPENAI_API_KEY
      usingServerKey = true
      userPlan = allowedUser.planType
    }
  }

  if (!apiKey) {
    return Response.json(
      { error: 'Clé OpenAI requise — configurez-la dans les paramètres' },
      { status: 401 }
    )
  }

  // Quota quotidien uniquement sur la clé serveur ET pour le plan subscription.
  if (usingServerKey && userPlan !== 'pro' && userPlan !== 'vip') {
    const quota = await consumeDailyQuota(env, email, 'whisper-1')
    if (!quota.allowed) {
      return Response.json(
        { error: 'Quota quotidien atteint — réessayez demain ou ajoutez votre propre clé OpenAI' },
        { status: 429 }
      )
    }
  }

  // Forward the multipart body untouched — Whisper needs the original
  // Content-Type boundary to parse the audio file.
  const contentType = request.headers.get('content-type') || ''

  try {
    const upstream = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': contentType,
      },
      body: request.body,
    })

    const respBody = await upstream.text()

    // Tracking tokens réels : si on est sur la clé serveur et que OpenAI a
    // répondu OK, parse la durée depuis verbose_json (ajouté côté client)
    // et record le coût précis.
    if (usingServerKey && upstream.ok) {
      const usage = parseWhisperBody(respBody)
      waitUntil(recordUsage(env, email, 'whisper-1', usage))
    }

    return new Response(respBody, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Whisper proxy error' },
      { status: 502 }
    )
  }
}
