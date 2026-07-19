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
import {
  checkPremiumCap,
  premiumCapReachedResponse,
  voidPremiumCap,
  type PremiumCapResult,
} from '../_lib/checkPremiumCap'
import { consumeDailyQuota, recordUsage, voidDailyQuota } from '../_lib/quota'
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
import {
  assertRequestContentLengthWithinLimit,
  OPENAI_CHAT_BODY_MAX_BYTES,
  OPENAI_TEXT_BODY_MAX_BYTES,
  readRequestTextWithLimit,
  requestBodyTooLargeResponse,
  RequestBodyTooLargeError,
} from '../_lib/boundedRequestBody'
import { validateOpenAIVisionPayload, type OpenAIVisionValidation } from '../_lib/openaiVision'
import {
  validateOpenAIVisionStream,
  type OpenAIVisionStreamValidation,
} from '../_lib/openaiVisionStream'

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

  // Le client annonce le transport vision : il reçoit 40 Mio et un parsing
  // streaming. Le texte historique reste borné à 10 Mio, ce qui ferme le pic
  // body + DOM + re-stringify sous la limite mémoire Worker de 128 Mio.
  const usesVisionTransport = request.headers.get('x-arty-vision') === '1'
  let body: BodyInit
  let parsedPayload: Record<string, unknown> | undefined
  let visionValidation: OpenAIVisionValidation = { ok: true, imageCount: 0, totalBytes: 0 }
  let streamedVision: Extract<OpenAIVisionStreamValidation, { ok: true }> | undefined
  let bufferedVisionBody: ReadableStream<Uint8Array> | undefined
  const cancelBufferedVision = async (response: Response): Promise<Response> => {
    if (bufferedVisionBody) {
      await bufferedVisionBody.cancel().catch(() => undefined)
      bufferedVisionBody = undefined
    }
    return response
  }

  if (usesVisionTransport) {
    // Killswitch réellement peu coûteux : quand la fonctionnalité est OFF, ne
    // pas lire ni parser jusqu'à 40 Mio avant de refuser.
    if (env.OPENAI_VISION_ENABLED !== 'true') {
      return Response.json({ error: 'vision_disabled' }, { status: 403 })
    }
    try {
      assertRequestContentLengthWithinLimit(request, OPENAI_CHAT_BODY_MAX_BYTES)
      if (!request.body) return Response.json({ error: 'invalid_request_body' }, { status: 400 })
      const [validationBody, upstreamBody] = request.body.tee()
      bufferedVisionBody = upstreamBody
      const result = await validateOpenAIVisionStream(validationBody, OPENAI_CHAT_BODY_MAX_BYTES)
      if (!result.ok) {
        return cancelBufferedVision(Response.json(
          { error: result.error, reason: result.reason },
          { status: result.status },
        ))
      }
      streamedVision = result
      body = upstreamBody
    } catch (err) {
      const response = err instanceof RequestBodyTooLargeError
        ? requestBodyTooLargeResponse(err.maxBytes)
        : Response.json({ error: 'invalid_request_body' }, { status: 400 })
      return cancelBufferedVision(response)
    }
  } else {
    try {
      body = await readRequestTextWithLimit(request, OPENAI_TEXT_BODY_MAX_BYTES)
    } catch (err) {
      if (err instanceof RequestBodyTooLargeError) {
        return requestBodyTooLargeResponse(err.maxBytes)
      }
      return Response.json({ error: 'invalid_request_body' }, { status: 400 })
    }
    try {
      const parsed = JSON.parse(body) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedPayload = parsed as Record<string, unknown>
      }
    } catch {
      // Le comportement texte historique laisse l'upstream produire son 400.
    }
    visionValidation = validateOpenAIVisionPayload(parsedPayload)
    if (!visionValidation.ok) {
      return Response.json(
        { error: visionValidation.error, reason: visionValidation.reason },
        { status: visionValidation.status },
      )
    }
    if (visionValidation.imageCount > 0) {
      return Response.json(
        { error: 'invalid_image_payload', reason: 'vision_transport_required' },
        { status: 400 },
      )
    }
  }

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
      if (identity.kind === 'email-trial') return cancelBufferedVision(trialExpiredResponse())
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
      return cancelBufferedVision(proKeyRequiredResponse())
    } else if (result) {
      apiKey = env.OPENAI_API_KEY
      usingServerKey = true
      userPlan = result.planType
      trialRemaining = result.trialRemaining
    }
  }

  if (!apiKey) {
    return cancelBufferedVision(Response.json(
      { error: 'Clé OpenAI requise — configurez-la dans les paramètres ou demandez l\'accès whitelist' },
      { status: 401 }
    ))
  }

  // Extract le nom du modèle pour le quota + le tracking coût.
  let modelName = 'gpt-5'
  if (streamedVision) {
    modelName = streamedVision.model
  } else if (typeof parsedPayload?.model === 'string' && parsedPayload.model.length > 0) {
    modelName = parsedPayload.model
  }

  // Streaming Chat Completions omit usage unless explicitly requested. Never
  // trust a wallet caller to include the billing metadata it will be charged on.
  let mustSerializeParsedPayload = false
  if (streamedVision) {
    // Le validateur streaming exige déjà include_usage + output entier borné.
  } else if (parsedPayload) {
    if (parsedPayload.stream === true) {
      const existing = parsedPayload.stream_options
      const alreadyIncludesUsage =
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing) &&
        (existing as Record<string, unknown>).include_usage === true
      if (!alreadyIncludesUsage) {
        parsedPayload.stream_options = {
          ...(existing && typeof existing === 'object' ? existing as Record<string, unknown> : {}),
          include_usage: true,
        }
        mustSerializeParsedPayload = true
      }
    }
  } else {
    body = enforceStreamUsage(body as string)
  }

  // Sans abo : si l'utilisateur a des crédits → wallet (n'importe quel modèle,
  // payé à l'usage) ; sinon OpenAI reste verrouillé en gratuit.
  let walletResId: string | undefined
  if (usingServerKey && userPlan === 'free') {
    let parsedBody: Record<string, unknown> = streamedVision
      ? {
          model: streamedVision.model,
          max_completion_tokens: streamedVision.maxCompletionTokens,
        }
      : parsedPayload ?? {}
    if (!streamedVision && !parsedPayload) {
      try {
        parsedBody = JSON.parse(body as string) as Record<string, unknown>
      } catch {
        /* body illisible → réserve au plafond (estimation input = 0) */
      }
    }
    const outputField = Object.hasOwn(parsedBody, 'max_completion_tokens')
      ? 'max_completion_tokens'
      : 'max_tokens'
    const previousOutputLimit = parsedBody[outputField]
    const enforcedOutputLimit = enforceWalletOutputLimit('openai', parsedBody)
    if (!streamedVision && parsedPayload && previousOutputLimit !== enforcedOutputLimit) {
      mustSerializeParsedPayload = true
    }
    const start = await beginWalletBilling(env, waitUntil, {
      email,
      model: modelName,
      provider: 'openai',
      body: parsedBody,
      ...(streamedVision
        ? { validatedInputTokens: streamedVision.validatedInputTokens }
        : {
            validatedImageTokens: visionValidation.ok ? visionValidation.validatedImageTokens : undefined,
            validatedImageCount: visionValidation.ok ? visionValidation.validatedImageCount : undefined,
          }),
    })
    if (start.mode === 'refuse') return cancelBufferedVision(start.response)
    if (start.mode === 'wallet') {
      walletResId = start.resId
      if (!streamedVision && (!parsedPayload || mustSerializeParsedPayload)) body = JSON.stringify(parsedBody)
    } else {
      // Essai épuisé sans crédits → 403 trial_expired ; sinon OpenAI verrouillé.
      if (wasTrialExhausted) return cancelBufferedVision(trialExpiredResponse())
      return cancelBufferedVision(freeModelLockedResponse(modelName))
    }
  }

  // Ne sérialiser que si le proxy a effectivement modifié le JSON. Le body
  // original est déjà validé et conserver une seconde string de ~32 Mio au
  // moment de l'appel upstream dépasserait vite la mémoire d'un Worker.
  if (parsedPayload && mustSerializeParsedPayload && !walletResId) {
    body = JSON.stringify(parsedPayload)
  }

  // Trial : restriction de modèles. Compteur déjà décrémenté en amont.
  if (usingServerKey && userPlan === 'trial' && !isModelAllowedInTrial(modelName)) {
    return cancelBufferedVision(trialModelRestrictedResponse())
  }

  // Quota quotidien uniquement sur la clé serveur ET seulement pour le plan
  // subscription. Pro/VIP illimités, trial cappé par son compteur KV dédié.
  // Revue C3 (18/07) : quota et cap sont consommés AVANT le fetch upstream —
  // on garde une trace de ce qui a été consommé pour le REMBOURSER si
  // l'upstream ne sert pas la réponse (sinon le retry d'éligibilité du
  // client, Terra rejeté → gpt-5, consommait 2 unités pour 1 message).
  let dailyConsumedModel: string | undefined
  let capConsumed: PremiumCapResult | undefined
  if (usingServerKey && userPlan === 'subscription') {
    const quota = await consumeDailyQuota(env, email, modelName)
    if (!quota.allowed) {
      return cancelBufferedVision(Response.json(
        {
          error: `Quota journalier atteint (${quota.count}/${quota.limit} appels aujourd'hui pour ${modelName}). Réessayez demain ou configurez votre propre clé.`,
          count: quota.count,
          limit: quota.limit,
        },
        { status: 429 }
      ))
    }
    dailyConsumedModel = modelName
  }

  // Cap mensuel premium uniquement pour le plan subscription.
  if (usingServerKey && userPlan === 'subscription') {
    const cap = await checkPremiumCap(email, modelName, env)
    if (!cap.allowed) {
      // Le quota journalier vient d'être consommé mais le message ne partira
      // pas — rembourser pour ne pas pénaliser le refus de cap.
      if (dailyConsumedModel) waitUntil(voidDailyQuota(env, email, dailyConsumedModel))
      return cancelBufferedVision(premiumCapReachedResponse(cap))
    }
    if (cap.reason === 'monthly_cap' || cap.reason === 'premium_pack') capConsumed = cap
  }

  // Plus aucun contrôle n'utilise l'arbre parsé. Libérer cette référence avant
  // le fetch permet au GC de rendre la copie des grandes strings base64 dès
  // que possible ; le body JSON original reste l'unique payload transféré.
  parsedPayload = undefined

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
    })
    // Le fetch a consommé/pris possession du stream ; ne plus retenir la
    // branche du tee dans la fermeture de la requête.
    bufferedVisionBody = undefined

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
      // Le fetch upstream a échoué → libère la réserve wallet en vol (PR #281)
      // ET rembourse quota/cap consommés en amont (revue C3 — invariant :
      // « quota/cap consommé ⟺ réponse servie »). Couvre le rejet de modèle
      // (retry client → sans ça, 2 unités par message) ET tout autre échec.
      if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
      if (capConsumed) waitUntil(voidPremiumCap(env, email, capConsumed))
      if (dailyConsumedModel) waitUntil(voidDailyQuota(env, email, dailyConsumedModel))
      // Leak d'info (N-2) : sur la clé serveur, masquer l'erreur OpenAI brute
      // (état de la clé owner). EXCEPTION : le rejet de modèle doit rester
      // détectable — le client (startChatRequest) s'en sert pour retomber de
      // DEFAULT_MODEL sur FALLBACK_MODEL. On renvoie un code stable contenant
      // « model_not_supported » qui matche sa regex, sans exposer le message
      // OpenAI. premium_cap_reached est émis avant le fetch (non concerné).
      // Passthrough conservé pour le BYOK.
      if (usingServerKey) {
        // Ne jamais journaliser le message upstream : il pourrait refléter une
        // portion du payload utilisateur. Le statut suffit au diagnostic.
        console.error('[openai] upstream error', response.status)
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
    if (capConsumed) waitUntil(voidPremiumCap(env, email, capConsumed))
    if (dailyConsumedModel) waitUntil(voidDailyQuota(env, email, dailyConsumedModel))
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(),
    })
  } catch (err) {
    if (bufferedVisionBody) {
      await bufferedVisionBody.cancel(err).catch(() => undefined)
      bufferedVisionBody = undefined
    }
    if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
    // Même invariant que le chemin !response.ok : rien n'a été servi.
    if (capConsumed) waitUntil(voidPremiumCap(env, email, capConsumed))
    if (dailyConsumedModel) waitUntil(voidDailyQuota(env, email, dailyConsumedModel))
    return Response.json(
      { error: err instanceof Error ? err.message : 'OpenAI proxy error' },
      { status: 502 }
    )
  }
}
