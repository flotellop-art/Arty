import type { Env } from '../../env'
import {
  parseAllowedEmails,
  resolveUserPlan,
  trialModelRestrictedResponse,
  verifyGoogleUserStrict,
} from '../_lib/checkAllowedUser'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { parseVoxtralBody } from '../_lib/trackUsage'

// Transcription EU (Mistral Voxtral, serveurs en France). Utilisé à la place
// de Whisper (OpenAI, US) pour la dictée des conversations euOnly — l'audio
// ne quitte pas l'Europe. Pattern miroir de whisper-proxy.ts.
const VOXTRAL_URL = 'https://api.mistral.ai/v1/audio/transcriptions'
const VOXTRAL_MODEL = 'voxtral-mini-latest'

// Borne anti-abus (audit V-1/V-2) : une dictée légitime fait < 1 MB ; 10 MB
// couvrent > 1 h d'opus. Comme Voxtral facture à la minute, ce cap borne
// aussi le coût par appel sur la clé serveur du owner.
const MAX_BODY_BYTES = 10 * 1024 * 1024

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : un token Google valide est obligatoire (CRIT-4).
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // Taille bornée AVANT toute consommation de quota (audit V-1). Les
  // navigateurs envoient toujours Content-Length avec un body FormData.
  const bodyLen = Number(request.headers.get('content-length') || '0')
  if (!bodyLen || bodyLen > MAX_BODY_BYTES) {
    return Response.json({ error: 'Audio missing or too large' }, { status: 413 })
  }

  // BYOK prioritaire via Authorization Bearer (même contrat que mistral-proxy).
  // Strip en regex insensible casse/espaces (audit V-3) — `.replace('Bearer ')`
  // littéral corromprait la clé sur `bearer x` et basculerait en silence sur
  // la clé serveur.
  let apiKey = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'

  // Fallback clé serveur pour les utilisateurs avec un plan actif. Comme pour
  // Whisper, la transcription n'est pas dans les modèles basiques de l'essai
  // gratuit : on lit le plan en read-only et on refuse les users trial.
  if (!apiKey && env.MISTRAL_API_KEY) {
    const allowedList = parseAllowedEmails(env.ALLOWED_EMAILS)
    const isWhitelisted = allowedList.includes(email)
    const plan = isWhitelisted ? 'vip' : await resolveUserPlan(env, email)
    if (plan === 'trial') {
      return trialModelRestrictedResponse()
    }
    if (plan === 'subscription' || plan === 'pro' || plan === 'vip') {
      apiKey = env.MISTRAL_API_KEY
      usingServerKey = true
      userPlan = plan
    }
  }

  if (!apiKey) {
    return Response.json(
      { error: 'Clé Mistral requise — configurez-la dans les paramètres' },
      { status: 401 }
    )
  }

  // Quota quotidien uniquement sur la clé serveur ET pour le plan subscription.
  if (usingServerKey && userPlan !== 'pro' && userPlan !== 'vip') {
    const quota = await consumeDailyQuota(env, email, VOXTRAL_MODEL)
    if (!quota.allowed) {
      return Response.json(
        { error: 'Quota quotidien atteint — réessayez demain ou ajoutez votre propre clé Mistral' },
        { status: 429 }
      )
    }
  }

  // Forward the multipart body untouched — Voxtral needs the original
  // Content-Type boundary to parse the audio file.
  const contentType = request.headers.get('content-type') || ''

  try {
    const upstream = await fetch(VOXTRAL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': contentType,
      },
      body: request.body,
    })

    const respBody = await upstream.text()

    // Leak d'info (audit V-4, même classe que N-2) : sur la clé serveur, ne
    // jamais renvoyer l'erreur Mistral brute (elle révèle l'état de la clé
    // owner : invalide / épuisée / rate-limited). Passthrough conservé pour
    // le BYOK — le message aide le user à diagnostiquer SA clé.
    if (!upstream.ok && usingServerKey) {
      console.error('[voxtral] upstream error', upstream.status, respBody.slice(0, 300))
      return Response.json({ error: 'Transcription failed' }, { status: 502 })
    }

    // Tracking coût réel : durée audio depuis usage.prompt_audio_seconds.
    if (usingServerKey && upstream.ok) {
      const usage = parseVoxtralBody(respBody)
      waitUntil(recordUsage(env, email, VOXTRAL_MODEL, usage))
    }

    return new Response(respBody, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Voxtral proxy error' },
      { status: 502 }
    )
  }
}
