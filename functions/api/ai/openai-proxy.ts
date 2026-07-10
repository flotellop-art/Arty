import type { Env } from '../../env'
import {
  checkAllowedUser,
  isModelAllowedInTrial,
  isTrialExpired,
  proKeyRequiredResponse,
  trialExpiredResponse,
  trialModelRestrictedResponse,
} from '../_lib/checkAllowedUser'
import {
  consumeEmailTrialMessage,
  emailTrialKey,
  resolveProxyIdentity,
} from '../_lib/emailTrial'
import { checkPremiumCap, premiumCapReachedResponse } from '../_lib/checkPremiumCap'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { freeModelLockedResponse } from '../_lib/freeQuota'
import {
  createOpenAIParser,
  enforceStreamUsage,
  responseUsageFormat,
  teeForParsing,
} from '../_lib/trackUsage'
import {
  beginWalletBilling,
  enforceWalletOutputLimit,
  makeReservationHeartbeat,
  settleWalletBilling,
  voidWalletBilling,
} from '../_lib/walletBilling'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais : identité Google OU jeton d'essai email (espace de clés disjoint,
  // plan figé 'trial', CRIT-1). Google prioritaire si les deux headers présents.
  const identity = await resolveProxyIdentity(request, env)
  if (!identity) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }
  const email = identity.kind === 'email-trial' ? emailTrialKey(identity.email) : identity.email

  // BYOK prioritaire via header dédié (aligné sur whisper-proxy).
  let apiKey = request.headers.get('x-openai-key') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'
  let trialRemaining: number | undefined
  // Essai épuisé routé vers le wallet (crédits) : mémorise l'origine pour rendre
  // un 403 trial_expired si pas de crédits (pas de tier gratuit OpenAI).
  let wasTrialExhausted = false

  // Fallback clé serveur pour les utilisateurs avec un plan actif
  // (sub/pro/vip/trial). `checkAllowedUser` gère le bypass VIP et le
  // décrément du compteur trial KV.
  if (!apiKey && env.OPENAI_API_KEY) {
    const result =
      identity.kind === 'email-trial'
        ? await consumeEmailTrialMessage(env, identity.email)
        : await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      // Essai email épuisé : pas de wallet (espace de clés disjoint, CRIT-1) → 403 direct.
      if (identity.kind === 'email-trial') return trialExpiredResponse()
      // Essai épuisé → wallet (crédits) au lieu d'un 403 sec. `cap_reached` n'a
      // pas décrémenté le compteur → pas de double-débit. On route comme 'free' ;
      // sans crédits, le bloc wallet rend trial_expired.
      apiKey = env.OPENAI_API_KEY
      usingServerKey = true
      userPlan = 'free'
      wasTrialExhausted = true
      trialRemaining = 0 // header x-trial-remaining:0 → débloque le premium via crédits (UI)
    } else if (result && result.planType === 'pro') {
      // Pro = BYOK (P2.5) : la licence donne l'app à vie, pas la clé serveur.
      return proKeyRequiredResponse()
    } else if (result) {
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

  let body = await request.text()

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

  // Streaming Chat Completions omit usage unless explicitly requested. Never
  // trust a wallet caller to include the billing metadata it will be charged on.
  body = enforceStreamUsage(body)

  // Sans abo : si l'utilisateur a des crédits → wallet (n'importe quel modèle,
  // payé à l'usage) ; sinon OpenAI reste verrouillé en gratuit.
  let walletResId: string | undefined
  if (usingServerKey && userPlan === 'free') {
    let parsedBody: Record<string, unknown> = {}
    try {
      parsedBody = JSON.parse(body) as Record<string, unknown>
    } catch {
      /* body illisible → réserve au plafond (estimation input = 0) */
    }
    enforceWalletOutputLimit('openai', parsedBody)
    const start = await beginWalletBilling(env, waitUntil, {
      email,
      model: modelName,
      provider: 'openai',
      body: parsedBody,
    })
    if (start.mode === 'refuse') return start.response
    if (start.mode === 'wallet') {
      walletResId = start.resId
      body = JSON.stringify(parsedBody)
    } else {
      // Essai épuisé sans crédits → 403 trial_expired ; sinon OpenAI verrouillé.
      if (wasTrialExhausted) return trialExpiredResponse()
      return freeModelLockedResponse(modelName)
    }
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
    if (!cap.allowed) return premiumCapReachedResponse(cap)
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
      // Le fetch upstream a échoué → libère la réserve wallet en vol (PR #281).
      if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
      // Leak d'info (N-2) : sur la clé serveur, masquer l'erreur OpenAI brute
      // (état de la clé owner). EXCEPTION : le rejet de modèle doit rester
      // détectable — le client (startChatRequest) s'en sert pour retomber de
      // DEFAULT_MODEL sur FALLBACK_MODEL. On renvoie un code stable contenant
      // « model_not_supported » qui matche sa regex, sans exposer le message
      // OpenAI. premium_cap_reached est émis avant le fetch (non concerné).
      // Passthrough conservé pour le BYOK.
      if (usingServerKey) {
        console.error('[openai] upstream error', response.status, errorText.slice(0, 300))
        const modelRejected =
          /model/i.test(errorText) && /not.?found|does.?not.?exist|unknown|invalid/i.test(errorText)
        if (modelRejected) {
          return Response.json(
            { error: { message: 'model_not_supported', code: 'model_not_supported' } },
            { status: 400 }
          )
        }
        return Response.json({ error: 'AI service error' }, { status: response.status })
      }
      return new Response(errorText, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      })
    }

    // Tracking tokens réels côté serveur — un seul tee, deux consommateurs
    // (analytics + débit wallet sur le chemin wallet).
    if (usingServerKey && response.body) {
      const parser = createOpenAIParser(responseUsageFormat(response.headers.get('content-type')))
      const { clientBody, parsedUsage } = teeForParsing(
        response.body,
        parser.feed,
        parser.finalize,
        makeReservationHeartbeat(env, walletResId)
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
      { error: err instanceof Error ? err.message : 'OpenAI proxy error' },
      { status: 502 }
    )
  }
}
