import type { Env } from '../../env'
import { checkAllowedUser, verifyGoogleUser } from '../_lib/checkAllowedUser'
import { checkPremiumCap, premiumCapReachedResponse } from '../_lib/checkPremiumCap'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { createGeminiParser, teeForParsing } from '../_lib/trackUsage'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : tout user Google authentifié est accepté (CRIT-4).
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK prioritaire
  let apiKey = request.headers.get('authorization')?.replace('Bearer ', '') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' = 'free'

  // Fallback clé serveur pour les utilisateurs avec un plan actif (sub/pro/vip)
  // ou la whitelist legacy en filet de secours.
  if (!apiKey && env.GEMINI_API_KEY) {
    const allowedUser = await checkAllowedUser(request, env)
    if (allowedUser) {
      apiKey = env.GEMINI_API_KEY
      usingServerKey = true
      userPlan = allowedUser.planType
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

    // Quota quotidien uniquement sur la clé serveur ET pour le plan subscription
    // (Pro/VIP illimités).
    if (usingServerKey && userPlan !== 'pro' && userPlan !== 'vip') {
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
      { error: err instanceof Error ? err.message : 'Gemini proxy error' },
      { status: 502 }
    )
  }
}
