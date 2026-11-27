import type { Env } from '../../env'
import { isAdmissionUnavailable, admissionUnavailableResponse } from '../_lib/admission'
import {
  checkAllowedVerifiedUser,
  isModelAllowedInTrial,
  isTrialExpired,
  proKeyRequiredResponse,
  trialExpiredResponse,
} from '../_lib/checkAllowedUser'
import {
  consumeEmailTrialMessage,
  emailTrialKey,
  proxyIdentityFailureResponse,
  resolveProxyIdentityDetailed,
} from '../_lib/emailTrial'
import { checkPremiumCap, premiumCapReachedResponse } from '../_lib/checkPremiumCap'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { freeModelLockedResponse } from '../_lib/freeQuota'
import { classifyUpstreamBilling } from '../_lib/upstreamBilling'
import {
  createMistralParser,
  enforceStreamUsage,
  responseUsageFormat,
  teeForParsing,
} from '../_lib/trackUsage'
import {
  beginWalletBilling,
  enforceWalletOutputLimit,
  makeReservationHeartbeat,
  settleWalletBilling,
} from '../_lib/walletBilling'
import { createUnservedRefunds, isRefundableUpstreamFailure } from '../_lib/unservedRefunds'

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais : identité Google OU jeton d'essai email (espace de clés disjoint,
  // plan figé 'trial', CRIT-1). Google prioritaire si les deux headers présents.
  const identityResolution = await resolveProxyIdentityDetailed(request, env)
  if (identityResolution.status !== 'ok') {
    return proxyIdentityFailureResponse(identityResolution)
  }
  const identity = identityResolution.identity
  const email = identity.kind === 'email-trial' ? emailTrialKey(identity.email) : identity.email
  // Issue #393 : tout ce qui est consommé avant le fetch upstream (essai,
  // quota, cap, réserve wallet) est rendu si la réponse n'est pas servie.
  const refunds = createUnservedRefunds(env, waitUntil, email, identity.email)

  // Lecture et validation syntaxique AVANT toute admission (même règle que
  // proxy.ts) : un body illisible ou un client qui abandonne ne doit jamais
  // coûter une unité d'essai. Un JSON invalide aurait de toute façon été
  // refusé par Mistral en 400.
  let body: string
  let bodyObj: Record<string, unknown>
  try {
    body = await request.text()
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not_an_object')
    bodyObj = parsed as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_request_body' }, { status: 400 })
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
    const result =
      identity.kind === 'email-trial'
        ? await consumeEmailTrialMessage(env, identity.email, waitUntil)
        : await checkAllowedVerifiedUser(identity.email, env, waitUntil)
    if (isAdmissionUnavailable(result)) return admissionUnavailableResponse()
    if (result && !isTrialExpired(result) && result.planType === 'trial' && result.trialDebited === true) {
      refunds.trackTrial(identity.kind)
    }
    if (isTrialExpired(result)) {
      // Essai email épuisé : pas de wallet (espace de clés disjoint, CRIT-1) → 403 direct.
      if (identity.kind === 'email-trial') return trialExpiredResponse()
      // Essai épuisé → wallet (crédits) au lieu d'un 403 sec. `cap_reached` n'a
      // pas décrémenté le compteur → pas de double-débit. On route comme 'free' ;
      // sans crédits, le bloc wallet rend trial_expired.
      apiKey = env.MISTRAL_API_KEY
      usingServerKey = true
      userPlan = 'free'
      wasTrialExhausted = true
      trialRemaining = 0 // header x-trial-remaining:0 → débloque le premium via crédits (UI)
    } else if (result && result.planType === 'pro') {
      // Pro = BYOK (P2.5) : la licence donne l'app à vie, pas la clé serveur.
      return proKeyRequiredResponse()
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

  // Extract le nom du modèle pour le quota + le tracking coût.
  let modelName = 'mistral'
  if (typeof bodyObj.model === 'string' && bodyObj.model.length > 0) {
    modelName = bodyObj.model
  }

  // Mistral's OpenAI-compatible stream only guarantees its final usage object
  // when include_usage is enabled. Enforce it server-side for billing.
  body = enforceStreamUsage(body)

  // Trial : override silencieux vers mistral-medium-latest si le modèle
  // demandé n'est pas autorisé en trial. Même logique que proxy.ts
  // (Anthropic). Plus de Mistral Small (déprécié mai 2026).
  if (usingServerKey && userPlan === 'trial' && !isModelAllowedInTrial(modelName)) {
    // Le body est déjà validé comme objet JSON avant l'admission : plus de
    // chemin d'échec après le débit d'essai.
    const trialBody = JSON.parse(body) as Record<string, unknown>
    trialBody.model = 'mistral-medium-latest'
    body = JSON.stringify(trialBody)
    modelName = 'mistral-medium-latest'
  }

  // Sans abo : si l'utilisateur a des crédits → wallet (n'importe quel modèle,
  // payé à l'usage) ; sinon Mistral reste verrouillé en gratuit (Small déprécié).
  let walletResId: string | undefined
  if (usingServerKey && userPlan === 'free') {
    let parsedBody: Record<string, unknown> = {}
    try {
      parsedBody = JSON.parse(body) as Record<string, unknown>
    } catch {
      /* body illisible → réserve au plafond (estimation input = 0) */
    }
    enforceWalletOutputLimit('mistral', parsedBody)
    const start = await beginWalletBilling(env, waitUntil, {
      email,
      model: modelName,
      provider: 'mistral',
      body: parsedBody,
    })
    if (start.mode === 'refuse') return start.response
    if (start.mode === 'wallet') {
      walletResId = start.resId
      refunds.trackWallet(walletResId)
      body = JSON.stringify(parsedBody)
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
    refunds.trackDailyQuota(modelName, quota.debited)
    if (!quota.allowed) {
      refunds.refundAll()
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
    if (!cap.allowed) {
      refunds.refundAll()
      return premiumCapReachedResponse(cap)
    }
    refunds.trackPremiumCap(cap)
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
      // Le fetch upstream a échoué → rend la réserve wallet (PR #281) et,
      // pour une panne/surcharge/facturation, essai, quota et cap (#393).
      // Le header d'erreur ne porte pas x-trial-remaining : rien à corriger.
      refunds.refundUnserved({
        counters: isRefundableUpstreamFailure(response.status, classifyUpstreamBilling(errorText) !== null),
      })
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
        // Catégorie exposée, détail toujours masqué (BUG 64) : sans elle, une
        // clé serveur à sec est indiscernable d'un bug de payload côté client.
        const billing = classifyUpstreamBilling(errorText)
        return new Response(JSON.stringify({ error: billing ?? 'AI service error' }), {
          status: response.status,
          headers,
        })
      }
      return new Response(errorText, { status: response.status, headers })
    }

    // Tracking tokens réels côté serveur — un seul tee, deux consommateurs
    // (analytics + débit wallet sur le chemin wallet).
    if (usingServerKey && response.body) {
      // Servie : le catch ne doit plus rien rendre, même si le tee levait.
      refunds.markServed()
      const parser = createMistralParser(responseUsageFormat(response.headers.get('content-type')))
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

    // Réponse OK sans body streamable (ou BYOK, qui n'a rien consommé).
    if (!response.body) {
      if (refunds.refundAll() && trialRemaining !== undefined) trialRemaining += 1
    } else {
      refunds.markServed()
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(),
    })
  } catch (err) {
    refunds.refundAll()
    // Message générique : err.message peut révéler des détails d'infra (F-6).
    console.error('[mistral] exception', err)
    return Response.json({ error: 'Mistral proxy error' }, { status: 502 })
  }
}
