import type { Env } from '../../env'
import {
  parseAllowedEmails,
  resolveUserPlan,
  verifyGoogleUser,
} from '../_lib/checkAllowedUser'
import { consumeTtsFreeQuota, TTS_FREE_DAILY_LIMIT } from '../_lib/freeQuota'

// Proxy TTS (text-to-speech) pour le brief vocal matinal. Calqué sur
// whisper-proxy.ts. La clé OpenAI reste côté serveur (RÈGLE 1) ; un token
// Google valide est obligatoire (anti-relais anonyme, CRIT-4).
//
// Décision produit : la voix est GRATUITE pour tous, mais plafonnée pour les
// comptes free/essai (TTS_FREE_DAILY_LIMIT/jour) pour borner le coût de la clé
// OpenAI serveur. Les plans payants (subscription/pro/vip) ont la voix
// illimitée. BYOK (header x-openai-key) = pas de plafond (l'utilisateur paie).
//
// Le frontend (src/components/home/MorningBrief.tsx) POST { text, voice } et
// reçoit du binaire audio/mpeg (MP3) à jouer.

const TTS_URL = 'https://api.openai.com/v1/audio/speech'
const TTS_MODEL = 'tts-1' // modèle stable et bon marché (~15 $/1M chars)
const MAX_TEXT_CHARS = 4096 // limite OpenAI TTS par requête
const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Anti-relais anonyme : un token Google valide est obligatoire (CRIT-4).
  const email = await verifyGoogleUser(request, env)
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

  // BYOK prioritaire (l'utilisateur paie sa propre clé → aucun plafond serveur).
  let apiKey = request.headers.get('x-openai-key') || ''

  if (!apiKey && env.OPENAI_API_KEY) {
    // Voix gratuite pour tous via la clé serveur. Free/essai : plafond
    // quotidien. Payants : illimité.
    const allowedList = parseAllowedEmails(env.ALLOWED_EMAILS)
    const plan = allowedList.includes(email) ? 'vip' : await resolveUserPlan(env, email)
    const isPaidPlan = plan === 'subscription' || plan === 'pro' || plan === 'vip'

    if (!isPaidPlan) {
      const quota = await consumeTtsFreeQuota(env, email)
      if (!quota.allowed) {
        return Response.json(
          {
            error: `Limite voix gratuite atteinte (${TTS_FREE_DAILY_LIMIT}/jour). Réessaie demain ou passe à Pro pour la voix illimitée.`,
            limit: TTS_FREE_DAILY_LIMIT,
          },
          { status: 429 }
        )
      }
    }
    apiKey = env.OPENAI_API_KEY
  }

  if (!apiKey) {
    // Ni BYOK, ni clé serveur configurée (cas config owner). Edge case.
    return Response.json(
      { error: 'Service vocal indisponible — ajoute ta clé OpenAI dans les paramètres' },
      { status: 503 }
    )
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
      // Erreur OpenAI : log serveur, message générique au client (ne pas
      // relayer le body upstream — audit 29 mai, leak).
      const errText = (await upstream.text()).slice(0, 300)
      console.error(`[tts] upstream ${upstream.status}:`, errText)
      return Response.json(
        { error: 'Service vocal temporairement indisponible' },
        { status: upstream.status === 429 ? 429 : 502 }
      )
    }

    // Succès : binaire audio relayé tel quel.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'audio/mpeg',
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[tts] proxy error', err)
    return Response.json({ error: 'TTS proxy error' }, { status: 502 })
  }
}
