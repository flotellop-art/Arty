import type { Env } from '../../env'
import { checkAllowedUser, verifyGoogleUser } from '../_lib/checkAllowedUser'
import { consumeDailyQuota } from '../_lib/quota'

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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

  // Fallback clé serveur uniquement pour les emails whitelistés.
  if (!apiKey && env.OPENAI_API_KEY) {
    const allowedEmail = await checkAllowedUser(request, env)
    if (allowedEmail) {
      apiKey = env.OPENAI_API_KEY
      usingServerKey = true
    }
  }

  if (!apiKey) {
    return Response.json(
      { error: 'Clé OpenAI requise — configurez-la dans les paramètres' },
      { status: 401 }
    )
  }

  // Quota quotidien uniquement pour les appels sur la clé serveur
  if (usingServerKey) {
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
