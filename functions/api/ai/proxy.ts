import type { Env } from '../../env'
import {
  checkAllowedUser,
  isModelAllowedInTrial,
  isTrialExpired,
  parseAllowedEmails,
  trialExpiredResponse,
  trialModelRestrictedResponse,
  verifyGoogleUser,
} from '../_lib/checkAllowedUser'
import { checkPremiumCap, premiumCapReachedResponse } from '../_lib/checkPremiumCap'
import { consumeDailyQuota, recordUsage } from '../_lib/quota'
import { createAnthropicParser, teeForParsing } from '../_lib/trackUsage'

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

  // Pas de BYOK → fallback sur la clé serveur si l'email a un plan actif
  // (subscription/pro/vip/trial via checkAllowedUser, qui gère aussi le
  // bypass VIP via ALLOWED_EMAILS et le décrément du compteur trial KV).
  if (!apiKey) {
    const result = await checkAllowedUser(request, env)
    if (isTrialExpired(result)) {
      return trialExpiredResponse()
    }
    if (result && env.ANTHROPIC_API_KEY) {
      apiKey = env.ANTHROPIC_API_KEY
      userPlan = result.planType
      trialRemaining = result.trialRemaining
    }
  }

  if (!apiKey) {
    const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
    const isWhitelisted = allowed.includes(email)
    const hasServerKey = !!env.ANTHROPIC_API_KEY
    let message: string
    if (!hasServerKey) {
      message = "Clé API requise — ANTHROPIC_API_KEY non configurée côté serveur."
    } else if (!isWhitelisted) {
      message = `Clé API requise — abonnement requis pour utiliser la clé serveur. Démarre un essai gratuit sur /api/trial/init.`
    } else {
      message = "Clé API requise — configuration serveur incomplète."
    }
    return Response.json(
      { error: message, email, isWhitelisted, hasServerKey },
      { status: 401 }
    )
  }

  const body = await request.text()

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

  // Trial : restriction de modèles. Le compteur a déjà été décrémenté par
  // `checkAllowedUser` ci-dessus ; si le modèle n'est pas autorisé on rend
  // l'message au client AVANT d'envoyer la requête à Anthropic, mais le
  // décrément est conservé (anti-abuse — éviter qu'un user spam le proxy
  // pour découvrir quels modèles sont autorisés sans payer).
  if (!isByok && userPlan === 'trial' && !isModelAllowedInTrial(modelName)) {
    return trialModelRestrictedResponse()
  }

  // Cap server-key usage per user per day. BYOK callers pay their own Anthropic
  // bill et trial users sont déjà cappés par leur compteur KV (30 messages),
  // donc seul le plan 'subscription' (et le legacy 'free' via whitelist) passe
  // par le quota journalier.
  const enforceDailyQuota =
    !isByok && (userPlan === 'subscription' || userPlan === 'free')
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
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 502 }
    )
  }
}
