import type { Env } from '../../env'
import { estimateReserveMicro } from './creditPricing'
import {
  getWalletBalance,
  reserveCredits,
  settleCredits,
  voidReservation,
  sweepStaleReservations,
  touchReservation,
  type WalletBalance,
} from './wallet'
import type { UsageTokens } from './pricing'

// ~4 caractères par token : approximation grossière mais suffisante pour une
// RÉSERVE (pessimiste par design). On ne cherche pas la précision du tokenizer,
// juste à ce que la réserve couvre l'ordre de grandeur de l'input.
const CHARS_PER_TOKEN = 4

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
  let chars = 0
  const addText = (v: unknown) => {
    if (typeof v === 'string') chars += v.length
  }
  const addContent = (content: unknown) => {
    if (typeof content === 'string') {
      chars += content.length
      return
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === 'object') addText((part as { text?: unknown }).text)
      }
    }
  }
  // system (Anthropic accepte string OU array de blocs)
  addContent(body.system)
  // messages[] (Anthropic / OpenAI / Mistral)
  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      if (m && typeof m === 'object') addContent((m as { content?: unknown }).content)
    }
  }
  // contents[].parts[].text (Gemini)
  if (Array.isArray(body.contents)) {
    for (const c of body.contents) {
      const parts = (c as { parts?: unknown }).parts
      if (Array.isArray(parts)) for (const p of parts) addText((p as { text?: unknown }).text)
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN)
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
  usage: UsageTokens,
): Promise<unknown> {
  return settleCredits(env, { ...params, modality: 'text', usage })
}

/** VOID — rendre la réserve sur échec upstream (!ok) ou exception. Via waitUntil. */
export function voidWalletBilling(env: Env, resId: string, email: string): Promise<unknown> {
  return voidReservation(env, resId, email)
}
