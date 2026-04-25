import type { Env } from '../../env'
import { checkAllowedUser, verifyGoogleUser } from '../_lib/checkAllowedUser'
import { checkPremiumCap, premiumCapReachedResponse } from '../_lib/checkPremiumCap'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { createOpenAIParser, teeForParsing } from '../_lib/trackUsage'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : tout user Google authentifié est accepté (CRIT-4).
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK prioritaire via header dédié (aligné sur whisper-proxy).
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

  // Quota quotidien uniquement sur la clé serveur ET seulement pour le plan
  // subscription. Pro/VIP n'ont pas de quota journalier (BYOK paye ses propres
  // appels, donc usingServerKey=false dans ce cas-là).
  if (usingServerKey && userPlan !== 'pro' && userPlan !== 'vip') {
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
      { error: err instanceof Error ? err.message : 'OpenAI proxy error' },
      { status: 502 }
    )
  }
}
