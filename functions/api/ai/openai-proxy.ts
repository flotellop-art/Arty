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
import { createOpenAIParser, teeForParsing } from '../_lib/trackUsage'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : tout user Google authentifié est accepté (CRIT-4).
  const email = await verifyGoogleUser(request, env)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK prioritaire via header dédié (aligné sur whisper-proxy).
  let apiKey = request.headers.get('x-openai-key') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'
  let trialRemaining: number | undefined

  // Fallback clé serveur pour les utilisateurs avec un plan actif
  // (sub/pro/vip/trial). `checkAllowedUser` gère le bypass VIP et le
  // décrément du compteur trial KV.
  if (!apiKey && env.OPENAI_API_KEY) {
    const result = await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      return trialExpiredResponse()
    }
    if (result) {
      apiKey = env.OPENAI_API_KEY
      usingServerKey = true
      userPlan = result.planType
      trialRemaining = result.trialRemaining
    }
  }

  if (!apiKey) {
    return Response.json(
      { error: 'Clé OpenAI requise — configurez-la dans les paramètres ou demandez l\'accès whitelist' },
      { status: 401 }
    )
  }

  const body = await request.text()

  // Extract le nom du modèle pour le quota + le tracking coût.
  let modelName = 'gpt-5'
  try {
    const parsed = JSON.parse(body) as { model?: unknown }
    if (typeof parsed.model === 'string' && parsed.model.length > 0) {
      modelName = parsed.model
    }
  } catch {
    // leave fallback
  }

  // Free : OpenAI intégralement verrouillé (modèles US, coûts élevés).
  if (usingServerKey && userPlan === 'free') {
    return freeModelLockedResponse(modelName)
  }

  // Trial : restriction de modèles. Compteur déjà décrémenté en amont.
  if (usingServerKey && userPlan === 'trial' && !isModelAllowedInTrial(modelName)) {
    return trialModelRestrictedResponse()
  }

  // Quota quotidien uniquement sur la clé serveur ET seulement pour le plan
  // subscription. Pro/VIP illimités, trial cappé par son compteur KV dédié.
  if (usingServerKey && userPlan === 'subscription') {
    const quota = await consumeDailyQuota(env, email, modelName)
    if (!quota.allowed) {
      return Response.json(
        {
          error: `Quota journalier atteint (${quota.count}/${quota.limit} appels aujourd'hui pour ${modelName}). Réessayez demain ou configurez votre propre clé.`,
          count: quota.count,
          limit: quota.limit,
        },
        { status: 429 }
      )
    }
  }

  // Cap mensuel premium uniquement pour le plan subscription.
  if (usingServerKey && userPlan === 'subscription') {
    const cap = await checkPremiumCap(email, modelName, env)
    if (!cap.allowed) return premiumCapReachedResponse()
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
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
      const errorText = await response.text().catch(() => 'Unknown OpenAI error')
      return new Response(errorText, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Tracking tokens réels côté serveur uniquement — tee du stream pour
    // parser usage.prompt_tokens / usage.completion_tokens dans le dernier
    // chunk SSE sans bloquer le forward client.
    if (usingServerKey && response.body) {
      const parser = createOpenAIParser()
      const { clientBody, parsedUsage } = teeForParsing(
        response.body,
        parser.feed,
        parser.finalize
      )
      waitUntil(parsedUsage.then((usage) => recordUsage(env, email, modelName, usage)))
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
      { error: err instanceof Error ? err.message : 'OpenAI proxy error' },
      { status: 502 }
    )
  }
}
