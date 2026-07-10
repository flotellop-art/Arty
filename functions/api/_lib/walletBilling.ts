import type { Env } from '../../env'
import { estimateReserveMicro } from './creditPricing'
import {
  drainWalletReversalsForUser,
  getWalletBalance,
  reserveCredits,
  settleCredits,
  voidReservation,
  sweepStaleReservations,
  touchReservation,
  type WalletBalance,
} from './wallet'
import type { MeasuredUsage } from './trackUsage'

// Une borne en octets UTF-8 est volontairement plus haute qu'un comptage BPE :
// elle reste sûre pour le CJK, les emoji, le code et les schémas d'outils.
const TOKEN_BOUND_ENCODER = new TextEncoder()
const MEDIA_TOKEN_FLOOR = 16_384
const REMOTE_MEDIA_TOKEN_FLOOR = 128_000
export const DEFAULT_WALLET_MAX_OUTPUT_TOKENS = 8_192
export const WALLET_MAX_OUTPUT_TOKENS = 65_536

// ─────────────────────────────────────────────────────────────────────
// Facturation wallet pour les proxys IA — briques composables (les 4 proxys
// ont 3 structures différentes, donc PAS de wrapper monolithique : chaque proxy
// appelle ces fonctions aux endroits de SA propre structure).
//
// Chemin d'usage (server-key, sans abo, !isByok) :
//   1. beginWalletBilling() AVANT le fetch → décide skip/wallet/refuse + réserve.
//   2. Si 'wallet' : le proxy SAUTE le tier gratuit (Haiku-lock + quotas) et,
//      après le stream, appelle settleWalletBilling() dans le .then(usage)
//      À CÔTÉ de recordUsage (UN seul tee, deux consommateurs).
//   3. Sur échec upstream (!response.ok) OU exception : voidWalletBilling().
//
// Politique d'échec D1 = FAIL-CLOSED (revue 2 agents Opus) : insuffisant → 402,
// D1 indispo → 503. JAMAIS de fail-open (= relais IA gratuit sur la clé owner
// pendant un incident D1 = CRIT-4 / RÈGLE 6). La gradation par modalité reste
// dans l'archi pour le futur path image ; en v1 (texte seul) les deux refusent.
// ─────────────────────────────────────────────────────────────────────

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'mistral'

export type WalletBillingStart =
  | { mode: 'skip' } // pas un user wallet → le proxy continue son flux normal
  | { mode: 'wallet'; resId: string } // réservé → sauter free/quotas, finaliser
  | { mode: 'refuse'; response: Response } // insuffisant / D1 indispo → renvoyer

/** max_tokens output selon le provider (le champ diffère à chaque fois). */
export function extractMaxOutputTokens(
  provider: AiProvider,
  body: Record<string, unknown>,
): number | undefined {
  const n = (v: unknown): number | undefined => (typeof v === 'number' && v > 0 ? v : undefined)
  switch (provider) {
    case 'openai':
      return n(body.max_completion_tokens) ?? n(body.max_tokens)
    case 'gemini': {
      const gc = body.generationConfig as { maxOutputTokens?: unknown } | undefined
      return n(gc?.maxOutputTokens)
    }
    case 'anthropic':
    case 'mistral':
    default:
      return n(body.max_tokens)
  }
}

/**
 * Estime les tokens d'ENTRÉE depuis le body, pour que la réserve couvre le coût
 * input (fix fuite F-A). Approximation ≈ chars/4, PESSIMISTE par design (on ne
 * retire pas le JSON/markdown). Couvre les 4 formats : system + messages[]
 * (Anthropic/OpenAI/Mistral) et contents[].parts[] (Gemini). Compte le TEXTE
 * uniquement — pas les blobs base64 (facturés différemment, surestimerait).
 */
export function estimateInputTokens(_provider: AiProvider, body: Record<string, unknown>): number {
  let tokens = TOKEN_BOUND_ENCODER.encode(JSON.stringify(body)).length

  const isMediaKey = (key: string) =>
    /^(image_url|inline_?data|file_?data|input_audio|audio|document|source)$/i.test(key)
  const isMediaPayloadKey = (key: string) =>
    /^(data|url|uri|file_?uri|image_url|input_audio)$/i.test(key)
  const looksEncoded = (value: string) =>
    value.startsWith('data:') || (value.length > 512 && /^[A-Za-z0-9+/=_-]+$/.test(value))

  const walk = (value: unknown, key = '', media = false): void => {
    if (typeof value === 'string') {
      if (isMediaKey(key) || (media && isMediaPayloadKey(key))) {
        const bytesAlreadyCounted = TOKEN_BOUND_ENCODER.encode(value).length
        const mediaBound = looksEncoded(value)
          ? Math.max(MEDIA_TOKEN_FLOOR, bytesAlreadyCounted)
          : REMOTE_MEDIA_TOKEN_FLOOR
        tokens += Math.max(0, mediaBound - bytesAlreadyCounted)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, media)
      return
    }
    if (!value || typeof value !== 'object') return

    const record = value as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    const mime = typeof record.mime_type === 'string'
      ? record.mime_type.toLowerCase()
      : typeof record.mimeType === 'string'
        ? record.mimeType.toLowerCase()
        : ''
    const thisMedia =
      media || /image|audio|document|file/.test(type) || /^(image|audio|video|application\/pdf)/.test(mime)
    if (thisMedia && !media) tokens += MEDIA_TOKEN_FLOOR

    for (const [childKey, child] of Object.entries(record)) {
      walk(child, childKey, thisMedia || isMediaKey(childKey))
    }
  }

  walk(body)
  return Math.ceil(tokens)
}

/**
 * Heartbeat throttlé d'une réservation pour un stream LONG (fix fuite F-B).
 * Renvoie une fonction à appeler pendant le parsing du stream : elle repousse
 * le sweeper (touchReservation) au plus une fois / 60 s, pour qu'un stream de
 * plus de 15 min ne soit PAS annulé en vol (sinon l'appel finit non facturé).
 * Best-effort, fire-and-forget, ne bloque jamais le parsing. No-op si pas de
 * réservation (chemin non-wallet).
 */
export function makeReservationHeartbeat(env: Env, resId: string | undefined): () => void {
  if (!resId) return () => {}
  let last = 0
  return () => {
    const now = Date.now()
    if (now - last < 60_000) return
    last = now
    // Fire-and-forget : la boucle de parsing tourne déjà sous le waitUntil du
    // settle (qui garde le worker vivant le temps du stream), donc ce touch
    // s'exécute dans cette fenêtre. On n'appelle PAS waitUntil ici — il serait
    // invoqué hors contexte requête (après le retour de la Response) → throw.
    void touchReservation(env, resId).catch(() => {})
  }
}

/**
 * Décide si l'appel passe par le wallet et, si oui, réserve. À appeler
 * UNIQUEMENT sur le chemin server-key sans plan (userPlan === 'free' && !isByok).
 * `body` est le corps parsé de la requête (pour estimer output + input).
 */
export async function beginWalletBilling(
  env: Env,
  waitUntil: (p: Promise<unknown>) => void,
  params: { email: string; model: string; provider: AiProvider; body: Record<string, unknown> },
): Promise<WalletBillingStart> {
  const { email, model, provider, body } = params

  // Auto-soin (pas de Cron sur Pages) : libère MES réservations orphelines d'un
  // settle/void raté précédent. En arrière-plan → hors chemin de latence ; le
  // bénéfice (solde rendu) s'applique dès la requête suivante.
  waitUntil(sweepStaleReservations(env, { email, limit: 10 }))

  // Une dette de refund/chargeback a priorité sur un nouvel appel IA. Si son
  // état ne peut pas être lu/appliqué, refuser le path wallet plutôt que de
  // réserver des fonds qui auraient dû être repris.
  const reversalDrain = await drainWalletReversalsForUser(env, email)
  if (reversalDrain.status === 'error') {
    return {
      mode: 'refuse',
      response: Response.json({ error: 'wallet_temporarily_unavailable' }, { status: 503 }),
    }
  }

  const bal: WalletBalance | null = await getWalletBalance(env, email)
  if (!bal || bal.availableMicro <= 0) return { mode: 'skip' }

  const maxOutputTokens = extractMaxOutputTokens(provider, body)
  const estInputTokens = estimateInputTokens(provider, body)
  const estMicro = estimateReserveMicro(model, maxOutputTokens, estInputTokens)
  const resId = crypto.randomUUID()
  const r = await reserveCredits(env, { email, estMicro, resId, model, modality: 'text' })

  if (r.status === 'reserved') return { mode: 'wallet', resId }
  if (r.status === 'insufficient') {
    return {
      mode: 'refuse',
      response: Response.json(
        { error: 'insufficient_credits', availableMicro: bal.availableMicro, estimatedMicro: estMicro },
        { status: 402 },
      ),
    }
  }
  // db_unavailable → fail-closed (refus), surtout PAS fail-open.
  return {
    mode: 'refuse',
    response: Response.json({ error: 'wallet_temporarily_unavailable' }, { status: 503 }),
  }
}

/** SETTLE — à appeler dans le .then(usage) du stream, à côté de recordUsage. */
export function settleWalletBilling(
  env: Env,
  params: { resId: string; email: string; model: string },
  usage: MeasuredUsage,
): Promise<unknown> {
  return settleCredits(env, {
    ...params,
    modality: 'text',
    usage,
    usageMeasured: usage.measured,
  })
}

/**
 * Impose au fournisseur le plafond exact utilisé par la réservation wallet.
 * Sans cette réécriture, une requête omettant max_tokens serait réservée à
 * 8 192 puis pourrait consommer le défaut (potentiellement supérieur) du
 * modèle. La borne haute protège aussi contre les budgets pathologiques.
 */
export function enforceWalletOutputLimit(
  provider: AiProvider,
  body: Record<string, unknown>,
): number {
  const requested = extractMaxOutputTokens(provider, body)
  const limit = Math.min(
    WALLET_MAX_OUTPUT_TOKENS,
    Math.max(1, Math.ceil(requested ?? DEFAULT_WALLET_MAX_OUTPUT_TOKENS)),
  )

  if (provider === 'gemini') {
    const current = body.generationConfig
    body.generationConfig = {
      ...(current && typeof current === 'object' ? current as Record<string, unknown> : {}),
      maxOutputTokens: limit,
    }
  } else if (provider === 'openai' && Object.prototype.hasOwnProperty.call(body, 'max_completion_tokens')) {
    body.max_completion_tokens = limit
  } else {
    body.max_tokens = limit
  }
  return limit
}

/** VOID — rendre la réserve sur échec upstream (!ok) ou exception. Via waitUntil. */
export function voidWalletBilling(env: Env, resId: string, email: string): Promise<unknown> {
  return voidReservation(env, resId, email)
}
