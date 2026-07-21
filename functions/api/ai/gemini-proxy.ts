import type { Env } from '../../env'
import {
  checkAllowedUser,
  isModelAllowedInTrial,
  isTrialExpired,
  proKeyRequiredResponse,
  trialExpiredResponse,
  trialModelRestrictedResponse,
  voidTrialMessage,
} from '../_lib/checkAllowedUser'
import {
  consumeEmailTrialMessage,
  emailTrialKey,
  resolveProxyIdentity,
  voidEmailTrialMessage,
} from '../_lib/emailTrial'
import {
  checkPremiumCap,
  premiumCapReachedResponse,
  voidPremiumCap,
  type PremiumCapResult,
} from '../_lib/checkPremiumCap'
import {
  consumeDailyQuota,
  recordUsage,
  voidDailyQuota,
  type QuotaDebit,
} from '../_lib/quota'
import { freeModelLockedResponse } from '../_lib/freeQuota'
import {
  createGeminiParser,
  responseUsageFormat,
  teeForParsing,
  type GeminiGroundingTool,
} from '../_lib/trackUsage'
import {
  beginWalletBilling,
  enforceWalletOutputLimit,
  makeReservationHeartbeat,
  settleWalletBilling,
  voidWalletBilling,
} from '../_lib/walletBilling'

const GEMINI_36_MODEL = 'gemini-3.6-flash'
const GEMINI_36_FALLBACK_MODEL = 'gemini-3.5-flash'
const GEMINI_UPSTREAM_BUDGET_MS = 50_000

function requestedGroundingTool(body: Record<string, unknown>): GeminiGroundingTool | undefined {
  if (!Array.isArray(body.tools)) return undefined
  for (const tool of body.tools) {
    if (tool && typeof tool === 'object' && 'google_maps' in tool) return 'maps'
  }
  for (const tool of body.tools) {
    if (tool && typeof tool === 'object' && 'google_search' in tool) return 'search'
  }
  return undefined
}

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

  let walletResId: string | undefined
  let dailyConsumed: { model: string; debited: QuotaDebit } | undefined
  let capConsumed: PremiumCapResult | undefined
  let trialConsumedBy: 'google' | 'email-trial' | undefined

  const scheduleTrialRefund = () => {
    if (trialConsumedBy === 'google') waitUntil(voidTrialMessage(env, identity.email))
    if (trialConsumedBy === 'email-trial') {
      waitUntil(voidEmailTrialMessage(env, identity.email))
    }
    trialConsumedBy = undefined
  }
  const scheduleUnservedRefunds = () => {
    if (walletResId) {
      waitUntil(voidWalletBilling(env, walletResId, email))
      walletResId = undefined
    }
    if (capConsumed) {
      waitUntil(voidPremiumCap(env, email, capConsumed))
      capConsumed = undefined
    }
    if (dailyConsumed) {
      waitUntil(voidDailyQuota(env, email, dailyConsumed.model, dailyConsumed.debited))
      dailyConsumed = undefined
    }
    scheduleTrialRefund()
  }

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
    if (
      result &&
      !isTrialExpired(result) &&
      result.planType === 'trial' &&
      result.trialDebited === true
    ) {
      trialConsumedBy = identity.kind
    }
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

  try {
    const { model: requestedModel, stream, ...body } = await request.json() as { model: string; stream: boolean; [key: string]: unknown }
    // Audit F-22 (3 juil. 2026) — `model` (body client) est interpolé dans
    // l'URL Gemini : format strict avant interpolation (même baseline que les
    // IDs Gmail/Drive), sinon injection de segment/query-string possible.
    if (typeof requestedModel !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(requestedModel)) {
      scheduleUnservedRefunds()
      return Response.json({ error: 'Invalid model' }, { status: 400 })
    }

    // Killswitch global. Un changement de variable Pages prend effet au retry
    // du déploiement, sans revert de code. Le modèle effectif est résolu AVANT
    // quota/réservation pour garder toute la comptabilité cohérente.
    let model =
      requestedModel === GEMINI_36_MODEL && env.GEMINI_36_DISABLED === 'true'
        ? GEMINI_36_FALLBACK_MODEL
        : requestedModel

    // Sans abo : si l'utilisateur a des crédits → wallet (n'importe quel modèle,
    // payé à l'usage) ; sinon Gemini reste verrouillé en gratuit.
    if (usingServerKey && userPlan === 'free') {
      enforceWalletOutputLimit('gemini', body)
      const start = await beginWalletBilling(env, waitUntil, {
        email,
        model,
        provider: 'gemini',
        body,
        // 3.5 est légèrement plus cher en output que 3.6 : la réserve couvre
        // donc aussi un éventuel fallback serveur, puis le settle rend l'écart.
        reservePricingModel: model === GEMINI_36_MODEL ? GEMINI_36_FALLBACK_MODEL : undefined,
      })
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
      scheduleUnservedRefunds()
      return trialModelRestrictedResponse()
    }

    // Quota quotidien uniquement sur la clé serveur ET pour le plan subscription
    // (Pro/VIP illimités, trial cappé par son propre compteur KV).
    if (usingServerKey && userPlan === 'subscription') {
      const quota = await consumeDailyQuota(env, email, model)
      if (!quota.allowed) {
        if (quota.debited) dailyConsumed = { model, debited: quota.debited }
        scheduleUnservedRefunds()
        return Response.json(
          {
            error: `Quota journalier atteint (${quota.count}/${quota.limit} appels aujourd'hui pour ${model}). Réessayez demain ou configurez votre propre clé.`,
            count: quota.count,
            limit: quota.limit,
          },
          { status: 429 }
        )
      }
      if (quota.debited) dailyConsumed = { model, debited: quota.debited }
    }

    // Cap mensuel premium uniquement pour le plan subscription.
    if (usingServerKey && userPlan === 'subscription') {
      const cap = await checkPremiumCap(email, model, env)
      if (!cap.allowed) {
        scheduleUnservedRefunds()
        return premiumCapReachedResponse(cap)
      }
      if (cap.debited) capConsumed = cap
    }

    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const suffix = stream ? '?alt=sse' : ''
    const upstreamSignal = AbortSignal.timeout(GEMINI_UPSTREAM_BUDGET_MS)
    const callModel = (candidateModel: string) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:${action}${suffix}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: upstreamSignal,
        }
      )

    let response = await callModel(model)

    // Un seul fallback, dans la même requête proxy et sous le même débit
    // trial/wallet. Jamais sur 400/401/403/429 : ces erreurs ne deviennent pas
    // valides en changeant de modèle. Le signal commun borne les deux appels à
    // 50 s au total.
    const shouldFallback =
      model === GEMINI_36_MODEL &&
      (response.status === 404 || (response.status >= 500 && response.status < 600))
    if (shouldFallback) {
      await response.body?.cancel().catch(() => undefined)

      // Le quota subscription est ventilé par modèle : déplacer l'unique
      // unité vers le modèle réellement servi avant le second appel.
      if (dailyConsumed) {
        await voidDailyQuota(env, email, dailyConsumed.model, dailyConsumed.debited)
        dailyConsumed = undefined
        const fallbackQuota = await consumeDailyQuota(env, email, GEMINI_36_FALLBACK_MODEL)
        if (!fallbackQuota.allowed) {
          if (fallbackQuota.debited) {
            dailyConsumed = { model: GEMINI_36_FALLBACK_MODEL, debited: fallbackQuota.debited }
          }
          scheduleUnservedRefunds()
          return Response.json(
            {
              error: `Quota journalier atteint (${fallbackQuota.count}/${fallbackQuota.limit} appels aujourd'hui pour ${GEMINI_36_FALLBACK_MODEL}). Réessayez demain ou configurez votre propre clé.`,
              count: fallbackQuota.count,
              limit: fallbackQuota.limit,
            },
            { status: 429 }
          )
        }
        if (fallbackQuota.debited) {
          dailyConsumed = { model: GEMINI_36_FALLBACK_MODEL, debited: fallbackQuota.debited }
        }
      }

      model = GEMINI_36_FALLBACK_MODEL
      response = await callModel(model)
    }

    const responseHeaders = (): Record<string, string> => {
      const out: Record<string, string> = {
        'content-type': response.headers.get('content-type') || 'text/event-stream',
        'cache-control': 'no-cache',
      }
      if (trialRemaining !== undefined) {
        out['x-trial-remaining'] = String(trialRemaining)
      }
      out['x-arty-model-used'] = model
      return out
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown Gemini error')
      // Rien n'a été servi : rendre wallet, quota, cap et unité d'essai.
      scheduleUnservedRefunds()
      // Leak d'info (N-2) : sur la clé serveur, ne JAMAIS renvoyer l'erreur
      // Gemini brute (elle révèle l'état de la clé owner : quota, projet,
      // modèles). Le status est préservé : le retry/backoff client (shouldRetry
      // sur 429/5xx) et le message 404 → errors.geminiModelNotFound s'appuient
      // sur le STATUS, pas sur le body. Le code premium_cap_reached est émis
      // plus haut (avant le fetch upstream), donc non concerné. Passthrough
      // conservé pour le BYOK : le message aide le user à diagnostiquer SA clé.
      if (usingServerKey) {
        // Le body peut refléter du contenu utilisateur : ne journaliser que le status.
        console.error('[gemini] upstream error', response.status)
        return Response.json(
          { error: 'AI service error' },
          { status: response.status, headers: responseHeaders() }
        )
      }
      return new Response(errorText, {
        status: response.status,
        headers: { ...responseHeaders(), 'content-type': 'application/json' },
      })
    }

    // Tracking tokens réels côté serveur — un seul tee, deux consommateurs
    // (analytics + débit wallet sur le chemin wallet).
    if (usingServerKey && response.body) {
      const usageFormat = stream
        ? responseUsageFormat(response.headers.get('content-type'))
        : 'json'
      const parser = createGeminiParser(usageFormat, requestedGroundingTool(body))
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

    scheduleUnservedRefunds()
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(),
    })
  } catch (err) {
    scheduleUnservedRefunds()
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gemini proxy error' },
      { status: 502 }
    )
  }
}
