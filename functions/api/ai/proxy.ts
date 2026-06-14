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
import {
  consumeFreeDailyQuota,
  freeModelLockedResponse,
  freeQuotaExhaustedResponse,
} from '../_lib/freeQuota'
import { createAnthropicParser, teeForParsing } from '../_lib/trackUsage'
import {
  beginWalletBilling,
  makeReservationHeartbeat,
  settleWalletBilling,
  voidWalletBilling,
} from '../_lib/walletBilling'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : tout appel doit venir d'un user Google authentifié,
  // même en BYOK. Empêche l'utilisation du proxy Cloudflare comme relais
  // ouvert par n'importe qui sur Internet (CRIT-4).
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }

  // BYOK prioritaire — si le client envoie sa propre clé, on l'utilise
  // telle quelle (chaque user paie ses propres appels, donc pas de quota
  // ni de décrément de trial).
  let apiKey = request.headers.get('x-api-key')
  const isByok = !!apiKey
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'
  let trialRemaining: number | undefined
  // Essai épuisé routé vers le wallet (crédits) : on mémorise l'origine pour
  // rendre un 403 trial_expired (et non le tier gratuit Haiku) si pas de crédits.
  let wasTrialExhausted = false

  // Pas de BYOK → fallback sur la clé serveur si l'email a un plan actif
  // (subscription/pro/vip/trial via checkAllowedUser, qui gère aussi le
  // bypass VIP via ALLOWED_EMAILS et le décrément du compteur trial KV).
  if (!apiKey) {
    const result = await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      // Essai épuisé : au lieu d'un 403 sec, on tente le wallet (crédits achetés).
      // `cap_reached` n'a PAS décrémenté le compteur (garantie atomique) → ce
      // message n'a rien consommé côté essai, donc le router vers le wallet ne
      // double-facture jamais. On route comme 'free' ; sans crédits, le fallback
      // du bloc wallet rend trial_expired (pas le tier Haiku gratuit).
      if (env.ANTHROPIC_API_KEY) {
        apiKey = env.ANTHROPIC_API_KEY
        userPlan = 'free'
        wasTrialExhausted = true
        // Informe le client que l'essai est épuisé (header x-trial-remaining:0)
        // → débloque les modèles premium via crédits côté UI (creditsCoverPremium).
        trialRemaining = 0
      } else {
        return trialExpiredResponse()
      }
    } else if (result && env.ANTHROPIC_API_KEY) {
      apiKey = env.ANTHROPIC_API_KEY
      userPlan = result.planType
      trialRemaining = result.trialRemaining
    }
  }

  if (!apiKey) {
    // LOW (audit étape 13) — message d'erreur uniforme. Avant : on exposait
    // `email`, `isWhitelisted`, `hasServerKey` dans la réponse → oracle pour
    // énumérer la whitelist (test d'emails arbitraires → différence de body).
    // Maintenant : message générique sans révéler l'état serveur.
    return Response.json(
      { error: "Clé API requise — abonnement Pro requis ou fournir une clé BYOK." },
      { status: 401 }
    )
  }

  let body = await request.text()

  // Extract the model name from the body so the quota breakdown in Settings
  // knows which model was called. Defaults to 'claude' if parsing fails —
  // the quota still works, we just lose granularity for that call.
  let modelName = 'claude'
  try {
    const parsed = JSON.parse(body) as { model?: unknown }
    if (typeof parsed.model === 'string' && parsed.model.length > 0) {
      modelName = parsed.model
    }
  } catch {
    // Leave fallback.
  }

  // Defense-in-depth: cap max_tokens for any Haiku request regardless of path.
  // claude-haiku-4-5-20251001 hard limit = 64000 output tokens.
  if (modelName.includes('haiku')) {
    try {
      const bodyObj = JSON.parse(body) as Record<string, unknown>
      if (typeof bodyObj.max_tokens === 'number' && bodyObj.max_tokens > 64000) {
        bodyObj.max_tokens = 64000
        body = JSON.stringify(bodyObj)
      }
    } catch { /* ignore */ }
  }

  // Trial : override silencieux du modèle vers Haiku si le modèle demandé
  // n'est pas autorisé. On ne retourne plus de 403 — on substitue le modèle
  // côté serveur pour garantir que les trials restent sur le tier gratuit
  // sans exposer d'erreur visible au client.
  if (!isByok && userPlan === 'trial' && !isModelAllowedInTrial(modelName)) {
    try {
      const bodyObj = JSON.parse(body) as Record<string, unknown>
      bodyObj.model = 'claude-haiku-4-5-20251001'
      // Haiku max_tokens = 64000 — cap pour éviter l'erreur 400
      if (typeof bodyObj.max_tokens === 'number' && bodyObj.max_tokens > 64000) {
        bodyObj.max_tokens = 64000
      }
      body = JSON.stringify(bodyObj)
      modelName = 'claude-haiku-4-5-20251001'
    } catch {
      return trialModelRestrictedResponse()
    }
  }

  // Sans abo : si l'utilisateur a des crédits, il passe par son WALLET (n'importe
  // quel modèle, payé à l'usage) ; sinon le tier gratuit Haiku 10/jour (inchangé).
  let walletResId: string | undefined
  if (!isByok && userPlan === 'free') {
    let parsedBody: Record<string, unknown> = {}
    try {
      parsedBody = JSON.parse(body) as Record<string, unknown>
    } catch {
      /* body illisible → réserve au plafond (estimation input = 0) */
    }
    const start = await beginWalletBilling(env, waitUntil, {
      email,
      model: modelName,
      provider: 'anthropic',
      body: parsedBody,
    })
    if (start.mode === 'refuse') return start.response
    if (start.mode === 'wallet') {
      walletResId = start.resId
    } else {
      // Pas de crédits. Essai ÉPUISÉ → 403 trial_expired : le tier Haiku gratuit
      // est réservé aux vrais 'free' (qui n'ont jamais eu d'essai), pas aux
      // essais déjà consommés.
      if (wasTrialExhausted) return trialExpiredResponse()
      // Vrai 'free' → tier gratuit Haiku 10/jour (filet 403 si non-Haiku).
      if (!modelName.toLowerCase().includes('haiku')) {
        return freeModelLockedResponse(modelName)
      }
      const free = await consumeFreeDailyQuota(env, email, modelName)
      if (!free.allowed) {
        return freeQuotaExhaustedResponse('claude-haiku', free.limit)
      }
    }
  }

  // Cap server-key usage per user per day. BYOK callers pay their own Anthropic
  // bill et trial users sont déjà cappés par leur compteur KV (30 messages),
  // donc seul le plan 'subscription' (et le legacy 'free' via whitelist) passe
  // par le quota journalier.
  // Le chemin wallet est déjà facturé à l'usage → il SAUTE le quota journalier
  // global (sinon un user crédité se prendrait un 429 au 51e message malgré ses crédits).
  const enforceDailyQuota =
    !isByok && !walletResId && (userPlan === 'subscription' || userPlan === 'free')
  if (enforceDailyQuota) {
    const quota = await consumeDailyQuota(env, email, modelName)
    if (!quota.allowed) {
      return Response.json(
        {
          error: `Quota journalier atteint (${quota.count}/${quota.limit} appels aujourd'hui). Réessayez demain ou configurez votre propre clé API dans les paramètres.`,
          count: quota.count,
          limit: quota.limit,
        },
        { status: 429 }
      )
    }
  }

  // Cap mensuel premium uniquement pour le plan subscription (Pro/VIP/trial
  // hors champ — Pro/VIP illimités, trial cappé par compteur dédié).
  if (!isByok && userPlan === 'subscription') {
    const cap = await checkPremiumCap(email, modelName, env)
    if (!cap.allowed) return premiumCapReachedResponse()
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
  }

  const beta = request.headers.get('anthropic-beta')
  if (beta) {
    headers['anthropic-beta'] = beta
  }

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers,
      body,
    })

    const responseHeaders = (extra: Record<string, string> = {}) => {
      const out: Record<string, string> = {
        'content-type': response.headers.get('content-type') || 'text/event-stream',
        'cache-control': 'no-cache',
        ...extra,
      }
      if (trialRemaining !== undefined) {
        out['x-trial-remaining'] = String(trialRemaining)
      }
      return out
    }

    // Ne track que les appels server-key réussis (BYOK = user paie lui-même).
    if (!isByok && response.ok && response.body) {
      const parser = createAnthropicParser()
      const { clientBody, parsedUsage } = teeForParsing(
        response.body,
        parser.feed,
        parser.finalize,
        makeReservationHeartbeat(env, walletResId)
      )
      // UN seul tee, deux consommateurs sur le MÊME usage réel : analytics
      // (recordUsage, coût provider) + débit wallet (settle, prix markupé). Le
      // settle n'a lieu que sur le chemin wallet (walletResId défini).
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

    // Upstream KO (ou pas de body streamable) : rendre la réserve éventuelle.
    if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(),
    })
  } catch (err) {
    // Échec réseau/exception après réserve → rendre la réserve.
    if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
    return Response.json(
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 502 }
    )
  }
}
