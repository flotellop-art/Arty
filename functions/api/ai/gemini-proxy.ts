import type { Env } from '../../env'
import {
  checkAllowedUser,
  isModelAllowedInTrial,
  isTrialExpired,
  trialExpiredResponse,
  trialModelRestrictedResponse,
  verifyGoogleUser,
} from '../_lib/checkAllowedUser'
import { checkPremiumCap, premiumCapReachedResponse } from '../_lib/checkPremiumCap'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { freeModelLockedResponse } from '../_lib/freeQuota'
import { createGeminiParser, teeForParsing } from '../_lib/trackUsage'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : tout user Google authentifié est accepté (CRIT-4).
  const email = await verifyGoogleUser(request, env)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK prioritaire
  let apiKey = request.headers.get('authorization')?.replace('Bearer ', '') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'
  let trialRemaining: number | undefined

  // Fallback clé serveur pour les utilisateurs avec un plan actif
  // (sub/pro/vip/trial). `checkAllowedUser` gère aussi le bypass VIP via
  // ALLOWED_EMAILS et le décrément automatique du compteur trial KV.
  if (!apiKey && env.GEMINI_API_KEY) {
    const result = await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      return trialExpiredResponse()
    }
    if (result) {
      apiKey = env.GEMINI_API_KEY
      usingServerKey = true
      userPlan = result.planType
      trialRemaining = result.trialRemaining
    }
  }

  if (!apiKey) {
    return Response.json(
      { error: 'Clé API requise — veuillez configurer votre clé dans les paramètres' },
      { status: 401 }
    )
  }

  try {
    const { model, stream, ...body } = await request.json() as { model: string; stream: boolean; [key: string]: unknown }

    // Free : Gemini intégralement verrouillé. Pour l'instant les utilisateurs
    // free n'ont accès qu'à Claude Haiku et Mistral Small. Si on souhaite
    // ouvrir Gemini Flash plus tard, il suffira d'ajouter une famille
    // gemini-flash dans freeQuota.ts et d'appeler consumeFreeDailyQuota ici.
    if (usingServerKey && userPlan === 'free') {
      return freeModelLockedResponse(model)
    }

    // Trial : restriction de modèles. Le compteur a déjà été décrémenté par
    // `checkAllowedUser` ci-dessus.
    if (usingServerKey && userPlan === 'trial' && !isModelAllowedInTrial(model)) {
      return trialModelRestrictedResponse()
    }

    // Quota quotidien uniquement sur la clé serveur ET pour le plan subscription
    // (Pro/VIP illimités, trial cappé par son propre compteur KV).
    if (usingServerKey && userPlan === 'subscription') {
      const quota = await consumeDailyQuota(env, email, model)
      if (!quota.allowed) {
        return Response.json(
          {
            error: `Quota journalier atteint (${quota.count}/${quota.limit} appels aujourd'hui pour ${model}). Réessayez demain ou configurez votre propre clé.`,
            count: quota.count,
            limit: quota.limit,
          },
          { status: 429 }
        )
      }
    }

    // Cap mensuel premium uniquement pour le plan subscription.
    if (usingServerKey && userPlan === 'subscription') {
      const cap = await checkPremiumCap(email, model, env)
      if (!cap.allowed) return premiumCapReachedResponse()
    }

    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const suffix = stream ? '?alt=sse' : ''
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}${suffix}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    })

    const responseHeaders = (): Record<string, string> => {
      const out: Record<string, string> = {
        'content-type': response.headers.get('content-type') || 'text/event-stream',
        'cache-control': 'no-cache',
      }
      if (trialRemaining !== undefined) {
        out['x-trial-remaining'] = String(trialRemaining)
      }
      return out
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown Gemini error')
      return new Response(errorText, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Tracking tokens réels côté serveur uniquement.
    if (usingServerKey && response.body) {
      const parser = createGeminiParser()
      const { clientBody, parsedUsage } = teeForParsing(
        response.body,
        parser.feed,
        parser.finalize
      )
      waitUntil(parsedUsage.then((usage) => recordUsage(env, email, model, usage)))
      return new Response(clientBody, {
        status: response.status,
        headers: responseHeaders(),
      })
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(),
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gemini proxy error' },
      { status: 502 }
    )
  }
}
