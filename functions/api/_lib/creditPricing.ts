// Couche de tarification CRÉDITS — transforme le coût fournisseur (pricing.ts)
// en montant débité au wallet (le "prix Arty"), via un markup en basis points
// modulé par modèle et modalité.
//
// ⚠️ LEVIERS BUSINESS — à régler, pas figés. Ce sont tes prix de vente.
//    Markup en CODE (pas en DB) : un changement de prix DOIT passer une review,
//    pas un UPDATE D1 qu'un panel compromis pourrait pousser (même raison que
//    les PRODUCT_ID hardcodés du webhook).
//
//    Convention : markupBps = points de base appliqués au coût fournisseur.
//      prix = coût × (10000 + markupBps) / 10000
//      10000 bps = +100% = prix ×2.   margin% = markupBps / (10000 + markupBps)
//      → 5000 bps = ×1.5 (33% marge) ; 13500 bps = ×2.35 (57% marge) ;
//        30000 bps = ×4 (75% marge).
//
//    Arbitrage à garder en tête en réglant le texte : plus le markup texte est
//    élevé, plus les gros utilisateurs ont intérêt à filer en BYOK. L'image
//    (modalité 'image') est le vrai moteur de marge ET le différenciateur — c'est
//    là qu'on marge fort, le texte reste raisonnable.

import { computeCostMicroUsd, getPricing, type UsageTokens } from './pricing'

export type Modality = 'text' | 'image'

interface MarkupRule {
  /** Markup sur le coût fournisseur, en basis points. */
  markupBps: number
  /** Plancher anti-poussière : montant minimum débité par appel (µ$). */
  minChargeMicro: number
}

// --- LEVIERS (défauts modérés, à confirmer/ajuster) ----------------------
// Texte : départ modéré (+50%, 33% de marge) pour rester compétitif face à un
// abo 10€ sur le profil moyen et ne pas chasser les gros vers le BYOK.
const MARKUP_TEXT_DEFAULT: MarkupRule = { markupBps: 5000, minChargeMicro: 200 }
// Image : le moteur de marge (départ +300%, 75% de marge — cf. doc d'audit).
const MARKUP_IMAGE_DEFAULT: MarkupRule = { markupBps: 30000, minChargeMicro: 8000 }

// Modulation fine par préfixe de modèle (optionnel). Vide = tout le texte au
// défaut. Exemple si tu veux marger davantage les flagships premium :
//   'claude-opus': { markupBps: 9000, minChargeMicro: 300 },
const MARKUP_BY_MODEL_PREFIX: Record<string, MarkupRule> = {}
// ------------------------------------------------------------------------

/** Budget output par défaut quand la requête n'en fournit aucun. Une limite
 * explicite est toujours réservée en entier : la réserve ne doit jamais être
 * inférieure au coût maximal que le fournisseur peut effectivement produire. */
const DEFAULT_RESERVE_OUTPUT_TOKENS = 8192

function ruleFor(model: string, modality: Modality): MarkupRule {
  if (modality === 'image') return MARKUP_IMAGE_DEFAULT
  // préfixe "provider-famille" (ex: 'claude-opus', 'gpt-5', 'gemini-3')
  const prefix = model.split(/[-@.]/).slice(0, 2).join('-')
  return MARKUP_BY_MODEL_PREFIX[prefix] ?? MARKUP_TEXT_DEFAULT
}

/**
 * Applique le markup à un coût fournisseur (µ$) → montant débité au wallet (µ$).
 * Générique : marche pour le texte (coût calculé après le stream) comme pour
 * l'image (coût fournisseur connu d'avance, une fois le path image construit).
 */
export function applyMarkup(providerCostMicro: number, model: string, modality: Modality): number {
  const rule = ruleFor(model, modality)
  // Garde isFinite : si getPricing renvoyait NaN pour un modèle inconnu (tarif
  // mal défini), on retombe sur 0 → le plancher minChargeMicro s'applique au
  // lieu d'écrire un NaN dans balance_micro côté D1.
  const base = Number.isFinite(providerCostMicro) && providerCostMicro > 0 ? providerCostMicro : 0
  const marked = Math.round((base * (10000 + rule.markupBps)) / 10000)
  return Math.max(Number.isFinite(marked) ? marked : 0, rule.minChargeMicro)
}

/** Coerce un compteur de tokens en entier fini >= 0 (parsing SSE foireux, BUG 52). */
const safeCount = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0)

/**
 * SETTLE texte : montant réel à débiter, markupé, à partir de l'usage mesuré
 * en fin de stream. providerCost exposé séparément pour le ledger (marge).
 * L'usage est assaini : un compteur NaN/négatif (stream tronqué) ne doit JAMAIS
 * produire un chargeMicro NaN qui ferait `balance_micro = NULL` côté D1.
 */
export function chargeForUsageMicro(
  model: string,
  usage: UsageTokens,
): { chargeMicro: number; providerCostMicro: number } {
  // Champs optionnels de UsageTokens (images, chars et télémétrie grounding)
  // VOLONTAIREMENT non copiés — ils ne débitent jamais le wallet. En
  // particulier les prompts/requêtes grounding : le tarif est une BORNE HAUTE
  // théorique (palier gratuit Google → coût réel souvent 0) tracée pour
  // l'analytics owner ; débiter des crédits réels sur un coût théorique
  // violerait la stratégie confiance. À réévaluer si la vigie montre un abus.
  const safe: UsageTokens = {
    inputTokens: safeCount(usage.inputTokens),
    outputTokens: safeCount(usage.outputTokens),
    cacheReadTokens: safeCount(usage.cacheReadTokens),
    cacheCreationTokens: safeCount(usage.cacheCreationTokens),
    audioSeconds: safeCount(usage.audioSeconds),
  }
  const providerCostMicro = computeCostMicroUsd(model, safe)
  // applyMarkup plancher à minChargeMicro > 0 → chargeMicro toujours fini et >= plancher.
  return { chargeMicro: applyMarkup(providerCostMicro, model, 'text'), providerCostMicro }
}

/**
 * RÉSERVE texte : estimation PESSIMISTE avant l'appel. Couvre l'OUTPUT (budget
 * plafonné) ET l'INPUT estimé (depuis la taille du prompt).
 *
 * ⚠️ Inclure l'input est CRITIQUE (fix fuite F-A, audit 14 juin) : avant, la
 * réserve ne couvrait que l'output (~centimes) alors que le settle débite
 * l'input réel. Un user pouvait acheter 1 ct de crédits, envoyer un prompt de
 * 200k tokens à Opus, et obtenir plusieurs $ d'IA en poussant son solde très
 * négatif. En réservant l'input, il doit AVOIR le solde correspondant pour que
 * l'appel passe — la fuite est colmatée. La sous-réserve résiduelle (output
 * réel > plafond) reste bornée et rattrapée au settle (politique explicite).
 */
export function estimateReserveMicro(
  model: string,
  maxTokens: number | undefined,
  estInputTokens = 0,
): number {
  // Une limite explicite est couverte en entier. En son absence, le budget par
  // défaut reste conservateur et cohérent avec les clients Arty.
  const tokens =
    Number.isFinite(maxTokens) && (maxTokens as number) > 0
      ? Math.ceil(maxTokens as number)
      : DEFAULT_RESERVE_OUTPUT_TOKENS
  const inTokens = Number.isFinite(estInputTokens) && estInputTokens > 0 ? estInputTokens : 0
  const p = getPricing(model)
  // µ$ = tokens × ($/Mtok) : les deux facteurs 1e6 (par-million ÷, micro ×) s'annulent.
  const outputCostMicro = Math.round(tokens * p.output)
  const inputCostMicro = Math.round(inTokens * p.input)
  return applyMarkup(outputCostMicro + inputCostMicro, model, 'text')
}

/**
 * Estime le coût CRÉDITS (markupé) d'un usage AGRÉGÉ d'un modèle sur une période,
 * pour le conseiller de facturation. Approxime le plancher PAR APPEL
 * (minChargeMicro) via le nombre d'appels — sinon on sous-estime les gros
 * volumes de petits appels (le markup sur l'agrégat raterait le plancher).
 */
export function estimateCreditsMicro(
  model: string,
  providerCostMicro: number,
  callCount: number,
): number {
  const marked = applyMarkup(Math.max(0, providerCostMicro), model, 'text')
  const rule = ruleFor(model, 'text')
  const floor = Math.max(0, callCount) * rule.minChargeMicro
  return Math.max(marked, floor)
}

// NOTE IMAGE : la génération d'image n'existe pas encore comme appel serveur
// facturé dans functions/ (les refs "image" actuelles = tool-use Gemini, pas de
// génération). Quand le path image sera construit (appel unaire, coût connu
// d'avance), il débitera via applyMarkup(coûtFournisseurImage, model, 'image') —
// le cas FACILE (settle exact, pas d'estimation). C'est là qu'est la marge.
