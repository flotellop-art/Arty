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
import {
  beginWalletBilling,
  extractMaxOutputTokens,
  settleWalletBilling,
  voidWalletBilling,
} from '../_lib/walletBilling'

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
  // Essai épuisé routé vers le wallet (crédits) : mémorise l'origine pour rendre
  // un 403 trial_expired si pas de crédits (pas de tier gratuit Mistral).
  let wasTrialExhausted = false

  // Fallback clé serveur pour les utilisateurs avec un plan actif
  // (sub/pro/vip/trial). `checkAllowedUser` gère le bypass VIP et le
  // décrément du compteur trial KV.
  if (!apiKey && env.MISTRAL_API_KEY) {
    const result = await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      // Essai épuisé → wallet (crédits) au lieu d'un 403 sec. `cap_reached` n'a
      // pas décrémenté le compteur → pas de double-débit. On route comme 'free' ;
      // sans crédits, le bloc wallet rend trial_expired.
      apiKey = env.MISTRAL_API_KEY
      usingServerKey = true
      userPlan = 'free'
      wasTrialExhausted = true
    } else if (result) {
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

  // Sans abo : si l'utilisateur a des crédits → wallet (n'importe quel modèle,
  // payé à l'usage) ; sinon Mistral reste verrouillé en gratuit (Small déprécié).
  let walletResId: string | undefined
  if (usingServerKey && userPlan === 'free') {
    let maxOut: number | undefined
    try {
      maxOut = extractMaxOutputTokens('mistral', JSON.parse(body) as Record<string, unknown>)
    } catch {
      /* maxOut undefined → réserve au plafond */
    }
    const start = await beginWalletBilling(env, waitUntil, {
      email,
      model: modelName,
      maxOutputTokens: maxOut,
    })
    if (start.mode === 'refuse') return start.response
    if (start.mode === 'wallet') {
      walletResId = start.resId
    } else {
      // Essai épuisé sans crédits → 403 trial_expired ; sinon Mistral verrouillé.
      if (wasTrialExhausted) return trialExpiredResponse()
      return freeModelLockedResponse(modelName)
    }
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
    if (!cap.allowed) return premiumCapReachedResponse()
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
      if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
      return new Response(errorText, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Tracking tokens réels côté serveur — un seul tee, deux consommateurs
    // (analytics + débit wallet sur le chemin wallet).
    if (usingServerKey && response.body) {
      const parser = createMistralParser()
      const { clientBody, parsedUsage } = teeForParsing(
        response.body,
        parser.feed,
        parser.finalize
      )
      const rid = walletResId
      waitUntil(
        parsedUsage.then((usage) =>
          Promise.allSettled([
            recordUsage(env, email, modelName, usage),
            ...(rid ? [settleWalletBilling(env, { resId: rid, email, model: modelName }, usage)] : []),
          ])
        )
      )
      return new Response(clientBody, {
        status: response.status,
        headers: responseHeaders(),
      })
    }

    if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(),
    })
  } catch (err) {
    if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
    return Response.json(
      { error: err instanceof Error ? err.message : 'Mistral proxy error' },
      { status: 502 }
    )
  }
}
