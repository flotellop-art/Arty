import type { Env } from '../../env'
import { BILLING_LEAK_PATTERN as SHARED_BILLING_LEAK_PATTERN } from '../_lib/upstreamBilling'
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
import {
  consumeFreeDailyQuota,
  freeModelLockedResponse,
  freeQuotaExhaustedResponse,
} from '../_lib/freeQuota'
import { createAnthropicParser, responseUsageFormat, teeForParsing } from '../_lib/trackUsage'
import {
  beginWalletBilling,
  enforceWalletOutputLimit,
  makeReservationHeartbeat,
  settleWalletBilling,
  voidWalletBilling,
} from '../_lib/walletBilling'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

// Anthropic renvoie en 400 DEUX familles d'erreurs : les requêtes malformées
// (notre bug : schéma d'outil, bloc invalide, champ manquant) et les problèmes
// de FACTURATION de la clé appelante (« credit balance is too low »). Seule la
// première est exposable : la seconde décrit l'état de la clé du propriétaire
// et reste masquée (invariant de l'audit F-6).
// Motifs SPÉCIFIQUES à la facturation. Volontairement pas de mot isolé trop
// courant (« plan », « quota », « upgrade ») : Anthropic les emploie aussi
// dans des messages purement techniques, et les masquer nous priverait du
// diagnostic sans rien protéger de plus.
// Motif partagé avec les proxys openai/mistral/gemini depuis le 10 août 2026
// (`_lib/upstreamBilling`) : le correctif BUG 64 n'existait que sur Anthropic,
// et son absence ailleurs a reproduit exactement le même angle mort.
const BILLING_LEAK_PATTERN = SHARED_BILLING_LEAK_PATTERN

// Haiku 4.5 ne supporte ni le thinking adaptatif ni `output_config.effort`
// (400), et pas non plus le server tool `web_fetch_20260209` — contrairement
// à `web_search_20250305`, choisi précisément pour sa compatibilité Haiku.
const HAIKU_UNSUPPORTED_TOOL_TYPES = ['web_fetch_20260209']

/**
 * Aligne le corps de requête sur le modèle RÉELLEMENT servi.
 * Exporté pour les tests : c'est l'invariant qui empêche un 400 quand le
 * serveur substitue un modèle sans que le client puisse le savoir.
 */
export function alignBodyWithServedModel(body: string, servedModel: string): string {
  if (!servedModel.toLowerCase().includes('haiku')) return body
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  } catch {
    return body
  }
  let changed = false
  if ('thinking' in parsed) { delete parsed.thinking; changed = true }
  if ('output_config' in parsed) { delete parsed.output_config; changed = true }
  if (typeof parsed.max_tokens === 'number' && parsed.max_tokens > 64000) {
    parsed.max_tokens = 64000
    changed = true
  }
  if (Array.isArray(parsed.tools)) {
    const kept = (parsed.tools as Array<Record<string, unknown>>).filter(
      (tool) => typeof tool?.type !== 'string' || !HAIKU_UNSUPPORTED_TOOL_TYPES.includes(tool.type)
    )
    if (kept.length !== parsed.tools.length) { parsed.tools = kept; changed = true }
  }
  return changed ? JSON.stringify(parsed) : body
}

/**
 * Message d'erreur 400 exposable au client, ou null s'il doit rester masqué.
 * Exporté pour les tests : la frontière « bug applicatif » / « état de la clé »
 * est un invariant de sécurité, elle doit être verrouillée.
 *
 * Terrain 9 août 2026 — leçon coûteuse : masquer TOUT un motif ne protège
 * rien d'exploitable, mais supprime le diagnostic. Les crédits de la clé
 * serveur étaient épuisés ; Anthropic le dit en 400 `invalid_request_error`,
 * ce filtre le masquait, et l'écran n'affichait qu'une erreur générique — ce
 * qui a coûté quatre correctifs de payload à côté de la plaque. On distingue
 * donc désormais la CATÉGORIE (exposée, actionnable) du DÉTAIL (masqué :
 * montants, seuils, identifiants d'organisation).
 */
export function safeUpstreamRequestError(detail: string): string | null {
  let message: unknown
  try {
    const parsed = JSON.parse(detail) as { error?: { type?: string; message?: unknown } }
    if (parsed?.error?.type !== 'invalid_request_error') return null
    message = parsed.error.message
  } catch {
    return null
  }
  if (typeof message !== 'string' || !message.trim()) return null
  if (BILLING_LEAK_PATTERN.test(message)) {
    // Catégorie seule, jamais le texte upstream : l'utilisateur sait que le
    // problème est côté service et non chez lui, l'exploitant sait où aller.
    return 'billing'
  }
  // Borne stricte : un message d'erreur n'a pas vocation à transporter du volume.
  return `Requête refusée par le service IA : ${message.slice(0, 300)}`
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  // Anti-relais anonyme : tout appel doit venir d'un user authentifié, même en
  // BYOK. Identité = token Google OU jeton d'essai email (espace de clés disjoint,
  // plan figé 'trial', CRIT-1). Google prioritaire si les deux headers présents.
  const identity = await resolveProxyIdentity(request, env)
  if (!identity) {
    return Response.json(
      { error: 'Authentication required — please sign in with Google' },
      { status: 401 }
    )
  }
  const email = identity.kind === 'email-trial' ? emailTrialKey(identity.email) : identity.email

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
    const result =
      identity.kind === 'email-trial'
        ? await consumeEmailTrialMessage(env, identity.email)
        : await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      // Essai email épuisé : pas de wallet/crédits (espace de clés disjoint,
      // CRIT-1 — un jeton email-trial n'a jamais de solde) → 403 trial_expired direct.
      if (identity.kind === 'email-trial') return trialExpiredResponse()
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
    } else if (result && result.planType === 'pro') {
      // Pro = BYOK (P2.5) : la licence donne l'app à vie, pas la clé serveur.
      return proKeyRequiredResponse()
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
    enforceWalletOutputLimit('anthropic', parsedBody)
    const start = await beginWalletBilling(env, waitUntil, {
      email,
      model: modelName,
      provider: 'anthropic',
      body: parsedBody,
    })
    if (start.mode === 'refuse') return start.response
    if (start.mode === 'wallet') {
      walletResId = start.resId
      body = JSON.stringify(parsedBody)
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
    if (!cap.allowed) return premiumCapReachedResponse(cap)
  }

  // Filet FINAL : le modèle réellement servi peut différer de celui demandé
  // par le client (substitution trial ci-dessus, plan verrouillé, wallet).
  // Le client construit `thinking`/`output_config` et le tool set d'après le
  // modèle DEMANDÉ (anthropicClient : `effortActive = enabled && !isHaiku`) —
  // il ne PEUT pas savoir. Seul ce point connaît le modèle final : c'est donc
  // ici qu'on aligne le payload, sinon Anthropic répond 400 (terrain 9 août).
  body = alignBodyWithServedModel(body, modelName)

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
      const parser = createAnthropicParser(responseUsageFormat(response.headers.get('content-type')))
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
    // Audit F-6 (3 juil. 2026) — chemin clé serveur : ne PAS forwarder le body
    // d'erreur Anthropic brut (état de la clé owner : rate-limit, crédits,
    // validité) à l'appelant. Détail loggé serveur uniquement (baseline N-2,
    // aligné sur les proxys openai/gemini/mistral/tts). Le user BYOK, lui,
    // reçoit l'erreur brute d'Anthropic : c'est SA clé.
    if (!isByok && !response.ok) {
      const detail = await response.text().catch(() => '')
      console.error('[proxy] upstream error', response.status, detail.slice(0, 500))
      // Terrain 9 août : un 400 opaque a coûté plusieurs allers-retours de
      // diagnostic. Un 400 `invalid_request_error` décrit NOTRE payload (un
      // bug applicatif), pas l'état de la clé du propriétaire — le masquer
      // n'apporte aucune sécurité et empêche de corriger. Le cas facturation
      // ne remonte que sa CATÉGORIE (`billing`), jamais le texte upstream :
      // assez pour agir, rien d'exploitable (cf. safeUpstreamRequestError).
      const safe = response.status === 400 ? safeUpstreamRequestError(detail) : null
      if (safe === 'billing') {
        return Response.json(
          { error: 'upstream_billing' },
          { status: 400, headers: responseHeaders() }
        )
      }
      if (safe) {
        return Response.json({ error: safe }, { status: 400, headers: responseHeaders() })
      }
      return Response.json({ error: 'AI service error' }, { status: response.status, headers: responseHeaders() })
    }
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders(),
    })
  } catch (err) {
    // Échec réseau/exception après réserve → rendre la réserve. Message
    // générique : err.message peut révéler des détails d'infra (F-6).
    if (walletResId) waitUntil(voidWalletBilling(env, walletResId, email))
    console.error('[proxy] exception', err)
    return Response.json({ error: 'Proxy error' }, { status: 502 })
  }
}
