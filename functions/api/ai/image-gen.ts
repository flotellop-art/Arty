import type { Env } from '../../env'
import {
  checkAllowedUser,
  isTrialExpired,
  proKeyRequiredResponse,
  trialExpiredResponse,
  verifyGoogleUserStrict,
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

// ── FLUX (Black Forest Labs) — second provider, routage par style ────────────
// Endpoint RÉGIONAL EU par défaut (« multi-cluster routing limited to EU
// regions — GDPR compliant », docs BFL) — meilleure posture même hors euOnly.
// ⚠️ Le chemin euOnly reste GATED côté client tant que le DPA + clause
// no-training + confirmation d'inférence EU ne sont pas obtenus de BFL
// (leurs API Terms autorisent l'entraînement sur les prompts par défaut).
// klein 9B ≈ $0.015/image 1024² — bon ratio qualité/coût pour le photoréalisme.
const BFL_BASE = 'https://api.eu.bfl.ai/v1'
const FLUX_MODEL = 'flux-2-klein-9b'
// Polling : l'API BFL est asynchrone (submit → polling_url → Ready). Bornes
// dimensionnées pour la limite de sous-requêtes des Pages Functions (~50) :
// 1 submit + ≤40 polls (1 s) + 1 download ≈ 42 sous-requêtes max.
const BFL_POLL_INTERVAL_MS = 1000
const BFL_MAX_POLLS = 40

/** Conversion bytes → base64 par chunks (BUG 50 : la concaténation char par
 *  char est O(n²) et crashe le Worker sur >2 MB). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[])
  }
  return btoa(binary)
}

/** Garde SSRF : le Worker ne suit que des URLs du domaine BFL (polling_url et
 *  sample viennent de la réponse BFL — défense en profondeur si altérée). */
function isBflUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname
    return h === 'bfl.ai' || h.endsWith('.bfl.ai')
  } catch {
    return false
  }
}

/** Génère via BFL : submit → poll → download (les URLs signées expirent en
 *  10 min et n'ont pas de CORS — le re-téléchargement serveur est obligatoire). */
async function generateViaFlux(prompt: string, bflKey: string): Promise<string | null> {
  const headers = { 'x-key': bflKey, 'content-type': 'application/json' }
  const submit = await fetch(`${BFL_BASE}/${FLUX_MODEL}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, width: 1024, height: 1024, output_format: 'png' }),
  })
  if (!submit.ok) {
    console.error('[image-gen] bfl submit', submit.status, (await submit.text().catch(() => '')).slice(0, 200))
    return null
  }
  const { polling_url } = (await submit.json()) as { polling_url?: string }
  if (!polling_url || !isBflUrl(polling_url)) return null

  for (let i = 0; i < BFL_MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, BFL_POLL_INTERVAL_MS))
    const poll = await fetch(polling_url, { headers: { 'x-key': bflKey } })
    if (!poll.ok) return null
    const data = (await poll.json()) as { status?: string; result?: { sample?: string } }
    if (data.status === 'Ready') {
      const sample = data.result?.sample
      if (!sample || !isBflUrl(sample)) return null
      const img = await fetch(sample)
      if (!img.ok) return null
      return bytesToBase64(new Uint8Array(await img.arrayBuffer()))
    }
    if (data.status === 'Error' || data.status === 'Failed') {
      console.error('[image-gen] bfl status', data.status)
      return null
    }
  }
  console.error('[image-gen] bfl timeout')
  return null
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
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
    if (result && result.planType === 'pro') {
      // Pro = BYOK (P2.5) : la licence donne l'app à vie, pas la clé serveur.
      return proKeyRequiredResponse()
    }
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
  // subscription : cap mensuel dédié (bucket gpt-image, PARTAGÉ entre les
  // providers — « 10 images/mois » toutes images confondues, lisible).
  // vip illimité. pro = BYOK (intercepté plus haut, jamais sur la clé serveur).
  // Le modèle flux est classifié dans le même bucket.
  if (usingServerKey && userPlan === 'subscription') {
    const cap = await checkPremiumCap(email, IMAGE_MODEL, env)
    if (!cap.allowed) return premiumCapReachedResponse(cap)
  }

  let prompt = ''
  let provider: 'openai' | 'flux' = 'openai'
  try {
    const parsed = (await request.json()) as { prompt?: unknown; provider?: unknown }
    if (typeof parsed.prompt === 'string') prompt = parsed.prompt.slice(0, MAX_PROMPT_CHARS).trim()
    // Validation serveur stricte du provider (jamais de valeur arbitraire).
    if (parsed.provider === 'flux') provider = 'flux'
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (prompt.length < 3) {
    return Response.json({ error: 'prompt_too_short' }, { status: 400 })
  }

  // ── Branche FLUX ──────────────────────────────────────────────────────────
  // Clé serveur BFL uniquement (pas de BYOK flux en v1) → réservé aux plans
  // payants. JAMAIS de fallback silencieux vers OpenAI ici : le choix du
  // provider appartient au client (qui ne fallback lui-même qu'HORS euOnly).
  if (provider === 'flux') {
    if (!env.BFL_API_KEY) {
      return Response.json({ error: 'flux_unavailable' }, { status: 503 })
    }
    if (!usingServerKey) {
      // BYOK OpenAI ou pas de plan : flux passe sur la clé serveur BFL → il
      // faut un plan payant. Le client retombera sur openai (sa clé).
      return Response.json({ error: 'image_plan_locked', upsell: true }, { status: 403 })
    }
    const b64 = await generateViaFlux(prompt, env.BFL_API_KEY)
    if (!b64) return Response.json({ error: 'image_failed' }, { status: 502 })
    waitUntil(
      recordUsage(env, email, FLUX_MODEL, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        audioSeconds: 0,
        images: 1,
      })
    )
    return Response.json({ b64, mimeType: 'image/png' })
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
