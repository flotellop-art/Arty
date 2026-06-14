import type { Env } from '../../env'
import {
  parseAllowedEmails,
  resolveUserPlan,
  trialModelRestrictedResponse,
  verifyGoogleUser,
} from '../_lib/checkAllowedUser'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { parseWhisperBody } from '../_lib/trackUsage'

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'

// Borne anti-abus (audit V-1, partagée avec voxtral-proxy) : une dictée
// légitime fait < 1 MB ; borne la bande passante et le coût par appel
// (facturation à la minute) sur la clé serveur du owner.
const MAX_BODY_BYTES = 10 * 1024 * 1024

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : un token Google valide est obligatoire (CRIT-4).
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // Taille bornée AVANT toute consommation de quota. Les navigateurs
  // envoient toujours Content-Length avec un body FormData.
  const bodyLen = Number(request.headers.get('content-length') || '0')
  if (!bodyLen || bodyLen > MAX_BODY_BYTES) {
    return Response.json({ error: 'Audio missing or too large' }, { status: 413 })
  }

  // BYOK prioritaire via header dédié (distinct de x-api-key utilisé par Anthropic).
  let apiKey = request.headers.get('x-openai-key') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'

  // Fallback clé serveur pour les utilisateurs avec un plan actif. On n'utilise
  // pas `checkAllowedUser` ici : Whisper n'est pas dans la liste des modèles
  // basiques de l'essai gratuit, donc accepter un user trial décrémenterait
  // son compteur sans valeur ajoutée. On lit le plan en read-only et on
  // refuse explicitement les users trial.
  if (!apiKey && env.OPENAI_API_KEY) {
    const allowedList = parseAllowedEmails(env.ALLOWED_EMAILS)
    const isWhitelisted = allowedList.includes(email)
    const plan = isWhitelisted ? 'vip' : await resolveUserPlan(env, email)
    if (plan === 'trial') {
      return trialModelRestrictedResponse()
    }
    if (plan === 'subscription' || plan === 'pro' || plan === 'vip') {
      apiKey = env.OPENAI_API_KEY
      usingServerKey = true
      userPlan = plan
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

    // Leak d'info (audit V-4, même classe que N-2) : sur la clé serveur, ne
    // pas renvoyer l'erreur OpenAI brute (révèle l'état de la clé owner).
    // EXCEPTION : le rejet de modèle doit rester détectable — le client
    // (whisperClient.transcribeWithFallback) s'en sert pour retomber de
    // gpt-4o-transcribe sur whisper-1. On renvoie un code stable qui matche
    // sa regex, sans exposer le message OpenAI.
    if (!upstream.ok && usingServerKey) {
      console.error('[whisper] upstream error', upstream.status, respBody.slice(0, 300))
      const modelRejected =
        /model/i.test(respBody) && /not.?found|does.?not.?exist|unknown|invalid/i.test(respBody)
      if (modelRejected) {
        return Response.json(
          { error: { message: 'model_not_supported', code: 'model_not_supported' } },
          { status: 400 }
        )
      }
      return Response.json({ error: 'Transcription failed' }, { status: 502 })
    }

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
