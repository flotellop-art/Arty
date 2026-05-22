import type { Env } from '../../env'
import {
  parseAllowedEmails,
  resolveUserPlan,
  trialModelRestrictedResponse,
  verifyGoogleUser,
} from '../_lib/checkAllowedUser'
import { consumeDailyQuota } from '../_lib/quota'

// Proxy TTS (text-to-speech) pour le brief vocal matinal. Calqué sur
// whisper-proxy.ts. La clé OpenAI reste côté serveur (RÈGLE 1) ; un token
// Google valide est obligatoire (anti-relais anonyme, CRIT-4). La synthèse
// vocale (clé serveur du owner) est réservée aux plans payants — les autres
// fournissent leur propre clé OpenAI (BYOK via header x-openai-key).
//
// Le frontend (src/components/home/MorningBrief.tsx) POST { text, voice } et
// reçoit du binaire audio/mpeg (MP3) à jouer.

const TTS_URL = 'https://api.openai.com/v1/audio/speech'
const TTS_MODEL = 'tts-1' // modèle stable et bon marché (~15 $/1M chars)
const MAX_TEXT_CHARS = 4096 // limite OpenAI TTS par requête
const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Anti-relais anonyme : un token Google valide est obligatoire (CRIT-4).
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // Corps : { text, voice? }. Le modèle reste serveur-contrôlé (coût).
  let body: { text?: unknown; voice?: unknown }
  try {
    body = (await request.json()) as { text?: unknown; voice?: unknown }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return Response.json({ error: 'Le champ "text" est requis' }, { status: 400 })
  }
  if (text.length > MAX_TEXT_CHARS) {
    return Response.json(
      { error: `Texte trop long (${text.length} > ${MAX_TEXT_CHARS} caractères)` },
      { status: 400 }
    )
  }
  const requestedVoice = typeof body.voice === 'string' ? body.voice : 'alloy'
  const voice = (ALLOWED_VOICES as ReadonlyArray<string>).includes(requestedVoice)
    ? requestedVoice
    : 'alloy'

  // BYOK prioritaire via header dédié (même convention que whisper-proxy).
  let apiKey = request.headers.get('x-openai-key') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'

  // Fallback clé serveur réservé aux plans payants. On lit le plan en read-only
  // (pas checkAllowedUser) pour ne pas décrémenter le compteur trial : la voix
  // n'est pas un modèle d'essai, on refuse explicitement les users trial.
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
      { error: 'Clé OpenAI requise — passez à Pro ou configurez votre clé dans les paramètres' },
      { status: 401 }
    )
  }

  // Quota quotidien sur la clé serveur (sauf pro/vip illimités), comme whisper.
  if (usingServerKey && userPlan !== 'pro' && userPlan !== 'vip') {
    const quota = await consumeDailyQuota(env, email, TTS_MODEL)
    if (!quota.allowed) {
      return Response.json(
        { error: 'Quota quotidien atteint — réessayez demain ou ajoutez votre propre clé OpenAI' },
        { status: 429 }
      )
    }
  }

  try {
    const upstream = await fetch(TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: text,
        voice,
        response_format: 'mp3',
      }),
    })

    if (!upstream.ok) {
      // Erreur OpenAI : on relaie le message (texte) sans exposer la clé.
      const errText = (await upstream.text()).slice(0, 300)
      return Response.json(
        { error: `TTS upstream ${upstream.status}: ${errText}` },
        { status: upstream.status === 429 ? 429 : 502 }
      )
    }

    // Succès : on renvoie le binaire audio tel quel.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'audio/mpeg',
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'TTS proxy error' },
      { status: 502 }
    )
  }
}
