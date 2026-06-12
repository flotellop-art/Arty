import type { Env } from '../../env'
import {
  checkAllowedUser,
  isTrialExpired,
  trialExpiredResponse,
  verifyGoogleUser,
} from '../_lib/checkAllowedUser'
import { checkPremiumCap, premiumCapReachedResponse } from '../_lib/checkPremiumCap'
import { recordUsage } from '../_lib/quota'

/**
 * P1.3 — Génération d'images (RÈGLE 3 : nouveau modèle IA via proxy serveur).
 *
 * gpt-image-1 (OpenAI) via l'`OPENAI_API_KEY` serveur DÉJÀ provisionnée
 * (même clé que openai-proxy) — zéro nouvelle variable. Endpoint distinct
 * du chat : `/v1/images/generations` retourne du JSON (pas de SSE).
 *
 * Gating par plan (clé serveur uniquement) :
 * - free / trial → bloqué (les images coûtent plus que Haiku ; pas dans l'offre).
 * - subscription → cap mensuel via bucket `gpt-image` (checkPremiumCap, 10/mois).
 * - pro / vip → illimité (ne passent pas par checkPremiumCap, comme le chat).
 * - BYOK (`x-openai-key`) → pas de cap (l'utilisateur paie sa propre facture).
 *
 * euOnly : la génération est bloquée CÔTÉ CLIENT (le tool n'est jamais injecté
 * pour une conversation EU, qui est forcée sur Mistral). Le serveur est
 * stateless sur le flag euOnly — la garantie est l'absence d'injection du tool.
 */

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations'
const IMAGE_MODEL = 'gpt-image-1'
// Qualité 'medium' 1024×1024 ≈ $0.04/image. Cap 10/mois → $0.40 worst-case.
// Tunables après une vigie d'un mois (cf. plan d'action P1.3).
const IMAGE_QUALITY = 'medium'
const IMAGE_SIZE = '1024x1024'
const MAX_PROMPT_CHARS = 2000

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json({ error: 'Authentication required — please sign in with Google' }, { status: 401 })
  }

  // BYOK prioritaire (header dédié, aligné sur openai-proxy).
  let apiKey = request.headers.get('x-openai-key') || ''
  let usingServerKey = false
  let userPlan: 'subscription' | 'pro' | 'vip' | 'free' | 'trial' = 'free'

  if (!apiKey && env.OPENAI_API_KEY) {
    const result = await checkAllowedUser(request, env)
    if (isTrialExpired(result)) return trialExpiredResponse()
    if (result) {
      apiKey = env.OPENAI_API_KEY
      usingServerKey = true
      userPlan = result.planType
    }
  }

  if (!apiKey) {
    return Response.json({ error: 'image_unavailable' }, { status: 401 })
  }

  // Plan gating sur la clé serveur. free/trial : la génération d'images n'est
  // pas dans l'offre — message d'upsell explicite (cohérent P0.7).
  if (usingServerKey && (userPlan === 'free' || userPlan === 'trial')) {
    return Response.json({ error: 'image_plan_locked', upsell: true }, { status: 403 })
  }
  // subscription : cap mensuel dédié (bucket gpt-image). pro/vip illimités.
  if (usingServerKey && userPlan === 'subscription') {
    const cap = await checkPremiumCap(email, IMAGE_MODEL, env)
    if (!cap.allowed) return premiumCapReachedResponse(cap)
  }

  let prompt = ''
  try {
    const parsed = (await request.json()) as { prompt?: unknown }
    if (typeof parsed.prompt === 'string') prompt = parsed.prompt.slice(0, MAX_PROMPT_CHARS).trim()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (prompt.length < 3) {
    return Response.json({ error: 'prompt_too_short' }, { status: 400 })
  }

  try {
    const res = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        n: 1,
        size: IMAGE_SIZE,
        quality: IMAGE_QUALITY,
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[image-gen] upstream', res.status, detail.slice(0, 300))
      // Message générique (pas de fuite du détail upstream — RÈGLE 6 leak).
      return Response.json({ error: 'image_failed' }, { status: 502 })
    }

    const data = (await res.json()) as { data?: Array<{ b64_json?: string }> }
    const b64 = data.data?.[0]?.b64_json
    if (!b64) {
      return Response.json({ error: 'image_failed' }, { status: 502 })
    }

    // Tracking coût réel (clé serveur uniquement). Coût fixe par image via
    // imagePerUnit dans pricing.ts — pas de tokens. N'bloque jamais le retour.
    if (usingServerKey) {
      waitUntil(
        recordUsage(env, email, IMAGE_MODEL, {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          audioSeconds: 0,
          images: 1,
        })
      )
    }

    return Response.json({ b64, mimeType: 'image/png' })
  } catch (err) {
    console.error('[image-gen] failed', err)
    return Response.json({ error: 'image_failed' }, { status: 502 })
  }
}
