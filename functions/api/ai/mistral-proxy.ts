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
import { createMistralParser, teeForParsing } from '../_lib/trackUsage'

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'

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
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'
  let trialRemaining: number | undefined

  // Fallback clé serveur pour les utilisateurs avec un plan actif
  // (sub/pro/vip/trial). `checkAllowedUser` gère le bypass VIP et le
  // décrément du compteur trial KV.
  if (!apiKey && env.MISTRAL_API_KEY) {
    const result = await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      return trialExpiredResponse()
    }
    if (result) {
      apiKey = env.MISTRAL_API_KEY
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

  let body = await request.text()

  // Extract le nom du modèle pour le quota + le tracking coût.
  let modelName = 'mistral'
  try {
    const parsed = JSON.parse(body) as { model?: unknown }
    if (typeof parsed.model === 'string' && parsed.model.length > 0) {
      modelName = parsed.model
    }
  } catch {
    // leave fallback
  }

  // Trial : override silencieux vers mistral-medium-latest si le modèle
  // demandé n'est pas autorisé en trial. Même logique que proxy.ts
  // (Anthropic). Plus de Mistral Small (déprécié mai 2026).
  if (usingServerKey && userPlan === 'trial' && !isModelAllowedInTrial(modelName)) {
    try {
      const bodyObj = JSON.parse(body) as Record<string, unknown>
      bodyObj.model = 'mistral-medium-latest'
      body = JSON.stringify(bodyObj)
      modelName = 'mistral-medium-latest'
    } catch {
      return trialModelRestrictedResponse()
    }
  }

  // Free : Mistral n'est plus accessible en free depuis la dépréciation
  // de Small (mai 2026). Medium est trop coûteux pour le tier gratuit.
  if (usingServerKey && userPlan === 'free') {
    return freeModelLockedResponse(modelName)
  }

  // Quota quotidien uniquement sur la clé serveur ET pour le plan subscription
  // (Pro/VIP illimités, trial cappé par compteur dédié).
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

  // Mistral n'a pas de modèle "premium" dans notre cap (mistral-small est
  // standard). On laisse l'appel à checkPremiumCap pour la cohérence
  // architecturale ; il retourne 'standard_model' immédiatement.
  if (usingServerKey && userPlan === 'subscription') {
    const cap = await checkPremiumCap(email, modelName, env)
    if (!cap.allowed) return premiumCapReachedResponse(cap)
  }

  try {
    const response = await fetch(MISTRAL_API_URL, {
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
      const errorText = await response.text().catch(() => 'Unknown Mistral error')
      // Fix 429 (11 juin 2026) — forwarder Retry-After d'upstream pour que
      // le backoff client attende le bon délai au lieu d'un délai aveugle.
      // Header de réponse recopié tel quel : aucune surface d'auth modifiée.
      const retryAfter = response.headers.get('retry-after')
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...(retryAfter ? { 'retry-after': retryAfter } : {}),
      }
      // Leak d'info (N-2) : sur la clé serveur, masquer l'erreur Mistral brute
      // (état de la clé owner). Status + retry-after préservés : le backoff
      // client et le typage 401/429 s'appuient sur le STATUS, pas sur le body.
      // Le quota journalier ({count,limit}) et premium_cap_reached sont émis
      // avant le fetch upstream, donc non concernés. Passthrough gardé en BYOK.
      if (usingServerKey) {
        console.error('[mistral] upstream error', response.status, errorText.slice(0, 300))
        return new Response(JSON.stringify({ error: 'AI service error' }), {
          status: response.status,
          headers,
        })
      }
      return new Response(errorText, { status: response.status, headers })
    }

    // Tracking tokens réels côté serveur uniquement.
    if (usingServerKey && response.body) {
      const parser = createMistralParser()
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
      { error: err instanceof Error ? err.message : 'Mistral proxy error' },
      { status: 502 }
    )
  }
}
