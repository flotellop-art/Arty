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
const MEDIA_TOKEN_FLOOR = 16_384
const REMOTE_MEDIA_TOKEN_FLOOR = 128_000
// PR-0 (CDC vision §0/A3, 19/07/2026) — une image encodée remplace son
// comptage octet-par-octet par UNE borne explicite. 16 384 couvre à la fois
// les modèles Claude haute résolution et une image Terra 4096 × 3072
// (~12 288 tokens selon le CDC), sans dépendre d'un second plancher implicite
// posé par la structure du body. Les PDF/audio restent volontairement sur le
// comportement historique, plus pessimiste : ce chantier vision ne doit pas
// modifier leur réservation sans compteur provider/page-aware dédié.
const IMAGE_PAYLOAD_TOKEN_BOUND = 16_384
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
 * input (fix fuite F-A). Comportement RÉEL (docblock réécrit en PR-0 — l'ancien
 * mentait : il annonçait « pas les blobs base64 » alors que le code les
 * comptait intégralement) :
 * - le TEXTE (JSON complet, outils inclus) est borné à 1 octet UTF-8 = 1 token,
 *   PESSIMISTE par design (~×4 vs BPE) ;
 * - chaque IMAGE ENCODÉE (base64 / data URL) est RETIRÉE du comptage texte et
 *   REMPLACÉE par une borne unique de 16 384 tokens ;
 * - les autres médias encodés (PDF/audio/inconnu) conservent le comptage
 *   historique de leurs octets, afin de ne pas introduire de sous-réservation
 *   dans un chantier qui ne concerne que la vision image ;
 * - un média DISTANT (URL http) garde le plancher pessimiste 128 000 (contenu
 *   inconnu au moment de la réserve).
 * Le settle reste basé sur l'usage réel remonté par le provider — ces bornes ne
 * touchent QUE la réservation. Couvre les 4 formats : system + messages[]
 * (Anthropic/OpenAI/Mistral, blocs source/image_url) et contents[].parts[]
 * (Gemini, inline_data/file_data).
 */
export function estimateInputTokens(
  provider: AiProvider,
  body: Record<string, unknown>,
  options: { validatedImageTokens?: number; validatedImageCount?: number } = {},
): number {
  const validatedImageTokens = options.validatedImageTokens
  const validatedImageCount = options.validatedImageCount
  if (validatedImageTokens !== undefined) {
    if (
      provider !== 'openai' ||
      !Number.isFinite(validatedImageTokens) ||
      validatedImageTokens < 0 ||
      !Number.isInteger(validatedImageTokens) ||
      !Number.isInteger(validatedImageCount) ||
      (validatedImageCount ?? 0) < 1 ||
      (validatedImageCount ?? 0) > 4
    ) {
      throw new Error('invalid_validated_image_tokens')
    }
  } else if (validatedImageCount !== undefined) {
    throw new Error('invalid_validated_image_tokens')
  }

  const isMediaKey = (key: string) =>
    /^(image_url|inline_?data|file_?data|input_audio|audio|document|source)$/i.test(key)
  const isMediaPayloadKey = (key: string) =>
    /^(data|url|uri|file_?uri|image_url|input_audio)$/i.test(key)
  const looksEncoded = (value: string) =>
    value.startsWith('data:') || (value.length > 512 && /^[A-Za-z0-9+/=_-]+$/.test(value))

  // 'image' = borne plate ; 'media' = borne proportionnelle plafonnée ; null =
  // pas un contexte média. En cas de doute (clé média sans type/mime lisible),
  // on retombe sur 'media' — la borne la PLUS pessimiste des deux.
  type MediaKind = 'image' | 'media' | null

  // Calcule simultanément la longueur UTF-8 brute et JSON d'une string sans
  // créer de Uint8Array ni appeler JSON.stringify sur un base64 de 32 Mio.
  const stringLengths = (value: string): { raw: number; json: number } => {
    let raw = 0
    let json = 2 // guillemets JSON
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      if (code === 0x22 || code === 0x5c) {
        raw += 1
        json += 2
      } else if (code <= 0x1f) {
        raw += 1
        json += code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
      } else if (code <= 0x7f) {
        raw += 1
        json += 1
      } else if (code <= 0x7ff) {
        raw += 2
        json += 2
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          raw += 4
          json += 4
          index += 1
        } else {
          raw += 3 // TextEncoder remplace un surrogate isolé par U+FFFD
          json += 6 // JSON.stringify l'échappe en \udxxx
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        raw += 3
        json += 6
      } else {
        raw += 3
        json += 3
      }
    }
    return { raw, json }
  }

  let removedValidatedImages = 0
  const walk = (value: unknown, key = '', kind: MediaKind = null): number => {
    if (typeof value === 'string') {
      const lengths = stringLengths(value)
      if (isMediaKey(key) || (kind && isMediaPayloadKey(key))) {
        let mediaBound: number
        // Une petite base64 (< 513 caractères) ne passe pas le détecteur
        // générique `looksEncoded`. Le contexte image + clé `data` (ou une
        // data URL explicite) suffit à la reconnaître sans confondre une URL
        // distante avec un payload encodé.
        const encodedImage =
          (kind === 'image' && key.toLowerCase() === 'data') || /^data:image\//i.test(value)
        if (encodedImage) {
          mediaBound = validatedImageTokens === undefined ? IMAGE_PAYLOAD_TOKEN_BOUND : 0
          if (validatedImageTokens !== undefined) removedValidatedImages += 1
        } else if (!looksEncoded(value)) {
          // Média distant : contenu inconnu à la réserve → plancher pessimiste.
          mediaBound = Math.max(REMOTE_MEDIA_TOKEN_FLOOR, lengths.raw)
        } else if (kind === 'image' || /^data:image\//i.test(value)) {
          mediaBound = validatedImageTokens === undefined ? IMAGE_PAYLOAD_TOKEN_BOUND : 0
          if (validatedImageTokens !== undefined) removedValidatedImages += 1
        } else {
          // PDF/audio/inconnu : ne pas changer leur réservation historique.
          // Un compteur fiable devra être fondé sur les pages/durée et le
          // provider avant de pouvoir retirer leur base64 du comptage texte.
          mediaBound = Math.max(MEDIA_TOKEN_FLOOR, lengths.raw)
        }
        // Conserve les guillemets/échappements JSON, remplace uniquement les
        // octets de la valeur média par sa borne.
        return lengths.json - lengths.raw + mediaBound
      }
      return lengths.json
    }
    if (Array.isArray(value)) {
      let total = 2 // []
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) total += 1
        const item = value[index]
        total += item === undefined || typeof item === 'function' || typeof item === 'symbol'
          ? 4 // null dans un tableau JSON
          : walk(item, key, kind)
      }
      return total
    }
    if (value === null) return 4
    if (typeof value === 'boolean') return value ? 4 : 5
    if (typeof value === 'number') return (JSON.stringify(value) ?? 'null').length
    if (typeof value !== 'object') return 0

    const record = value as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    const rawMime = record.mime_type ?? record.mimeType ?? record.media_type
    const mime = typeof rawMime === 'string' ? rawMime.toLowerCase() : ''
    const isImage = /image/.test(type) || /^image\//.test(mime)
    const isOtherMedia =
      /audio|document|file/.test(type) || /^(audio|video|application\/pdf)/.test(mime)
    // Une évidence image EXPLICITE (type/mime) raffine un kind hérité 'media'
    // (cas Gemini : la clé inline_data pose 'media' avant que mime_type
    // image/* soit lisible un niveau plus bas).
    const thisKind: MediaKind = isImage ? 'image' : kind ?? (isOtherMedia ? 'media' : null)
    // Le plancher de bloc historique reste pour les médias non-image. Une
    // image possède déjà sa borne unique explicite : ne pas la doubler selon
    // la forme Anthropic/OpenAI du body.
    let total = 2 + (thisKind === 'media' && !kind ? MEDIA_TOKEN_FLOOR : 0) // {}

    let serializedEntries = 0
    for (const [childKey, child] of Object.entries(record)) {
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue
      if (serializedEntries > 0) total += 1
      serializedEntries += 1
      total += stringLengths(childKey).json + 1 // clé + deux-points
      total += walk(child, childKey, thisKind ?? (isMediaKey(childKey) ? 'media' : null))
    }
    return total
  }

  let tokens = walk(body)
  // PR-B vision : uniquement pour OpenAI, le proxy remplace les bornes plates
  // par la somme calculée depuis les dimensions extraites des bytes validés.
  // Les autres providers — et surtout les PDF — gardent le contrat PR-0.
  if (validatedImageTokens !== undefined) {
    if (removedValidatedImages !== validatedImageCount) {
      throw new Error('validated_image_count_mismatch')
    }
    tokens += validatedImageTokens
  }
  return Math.ceil(Math.max(0, tokens))
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
  params: {
    email: string
    model: string
    provider: AiProvider
    body: Record<string, unknown>
    validatedImageTokens?: number
    validatedImageCount?: number
    validatedInputTokens?: number
  },
): Promise<WalletBillingStart> {
  const {
    email,
    model,
    provider,
    body,
    validatedImageTokens,
    validatedImageCount,
    validatedInputTokens,
  } = params

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
  if (
    validatedInputTokens !== undefined &&
    (
      provider !== 'openai' ||
      !Number.isSafeInteger(validatedInputTokens) ||
      validatedInputTokens < 0 ||
      validatedImageTokens !== undefined ||
      validatedImageCount !== undefined
    )
  ) throw new Error('invalid_validated_input_tokens')
  const estInputTokens = validatedInputTokens ??
    estimateInputTokens(provider, body, { validatedImageTokens, validatedImageCount })
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
