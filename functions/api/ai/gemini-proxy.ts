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
import { createGeminiParser, teeForParsing } from '../_lib/trackUsage'
import {
  beginWalletBilling,
  makeReservationHeartbeat,
  settleWalletBilling,
  voidWalletBilling,
} from '../_lib/walletBilling'

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

  // BYOK prioritaire
  let apiKey = request.headers.get('authorization')?.replace('Bearer ', '') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'
  let trialRemaining: number | undefined
  // Essai épuisé routé vers le wallet (crédits) : mémorise l'origine pour rendre
  // un 403 trial_expired si pas de crédits (pas de tier gratuit Gemini).
  let wasTrialExhausted = false

  // Fallback clé serveur pour les utilisateurs avec un plan actif
  // (sub/pro/vip/trial). `checkAllowedUser` gère aussi le bypass VIP via
  // ALLOWED_EMAILS et le décrément automatique du compteur trial KV.
  if (!apiKey && env.GEMINI_API_KEY) {
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
      apiKey = env.GEMINI_API_KEY
      usingServerKey = true
      userPlan = 'free'
      wasTrialExhausted = true
      trialRemaining = 0 // header x-trial-remaining:0 → débloque le premium via crédits (UI)
    } else if (result && result.planType === 'pro') {
      // Pro = BYOK (P2.5) : la licence donne l'app à vie, pas la clé serveur.
      return proKeyRequiredResponse()
    } else if (result) {
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

  // Déclaré HORS du try pour rester visible dans le catch (rendre la réserve).
  let walletResId: string | undefined
  try {
    const { model, stream, ...body } = await request.json() as { model: string; stream: boolean; [key: string]: unknown }

    // Sans abo : si l'utilisateur a des crédits → wallet (n'importe quel modèle,
    // payé à l'usage) ; sinon Gemini reste verrouillé en gratuit.
    if (usingServerKey && userPlan === 'free') {
      const start = await beginWalletBilling(env, waitUntil, { email, model, provider: 'gemini', body })
      if (start.mode === 'refuse') return start.response
      if (start.mode === 'wallet') {
        walletResId = start.resId
      } else {
        // Essai épuisé sans crédits → 403 trial_expired ; sinon Gemini verrouillé.
        if (wasTrialExhausted) return trialExpiredResponse()
        return freeModelLockedResponse(model)
      }
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
      if (!cap.allowed) return premiumCapReachedResponse(cap)
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
      // Le fetch upstream a échoué → libère la réserve wallet en vol (refund
      // de l'input pré-réservé, PR #281) avant de répondre.
      if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
      // Leak d'info (N-2) : sur la clé serveur, ne JAMAIS renvoyer l'erreur
      // Gemini brute (elle révèle l'état de la clé owner : quota, projet,
      // modèles). Le status est préservé : le retry/backoff client (shouldRetry
      // sur 429/5xx) et le message 404 → errors.geminiModelNotFound s'appuient
      // sur le STATUS, pas sur le body. Le code premium_cap_reached est émis
      // plus haut (avant le fetch upstream), donc non concerné. Passthrough
      // conservé pour le BYOK : le message aide le user à diagnostiquer SA clé.
      if (usingServerKey) {
        console.error('[gemini] upstream error', response.status, errorText.slice(0, 300))
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
      const parser = createGeminiParser()
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
            recordUsage(env, email, model, usage),
            ...(rid ? [settleWalletBilling(env, { resId: rid, email, model }, usage)] : []),
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
      { error: err instanceof Error ? err.message : 'Gemini proxy error' },
      { status: 502 }
    )
  }
}
