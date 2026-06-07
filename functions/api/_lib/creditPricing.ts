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

/** Réserve forfaitaire (µ$) quand on ne peut pas estimer (max_tokens absent). */
const DEFAULT_RESERVE_TEXT_MICRO = 50_000 // 0.05 $ plafond pessimiste

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
  const marked = Math.round((providerCostMicro * (10000 + rule.markupBps)) / 10000)
  return Math.max(marked, rule.minChargeMicro)
}

/**
 * SETTLE texte : montant réel à débiter, markupé, à partir de l'usage mesuré
 * en fin de stream. providerCost exposé séparément pour le ledger (marge).
 */
export function chargeForUsageMicro(
  model: string,
  usage: UsageTokens,
): { chargeMicro: number; providerCostMicro: number } {
  const providerCostMicro = computeCostMicroUsd(model, usage)
  return { chargeMicro: applyMarkup(providerCostMicro, model, 'text'), providerCostMicro }
}

/**
 * RÉSERVE texte : estimation PESSIMISTE avant l'appel (on suppose tout le budget
 * output consommé). Mieux vaut sur-réserver et rendre le reliquat au settle que
 * sous-réserver et laisser le solde plonger.
 */
export function estimateReserveMicro(model: string, maxTokens: number | undefined): number {
  if (!maxTokens || maxTokens <= 0) return DEFAULT_RESERVE_TEXT_MICRO
  const p = getPricing(model)
  // µ$ = tokens × ($/Mtok) : les deux facteurs 1e6 (par-million ÷, micro ×) s'annulent.
  const outputCostMicro = Math.round(maxTokens * p.output)
  return applyMarkup(outputCostMicro, model, 'text')
}

// NOTE IMAGE : la génération d'image n'existe pas encore comme appel serveur
// facturé dans functions/ (les refs "image" actuelles = tool-use Gemini, pas de
// génération). Quand le path image sera construit (appel unaire, coût connu
// d'avance), il débitera via applyMarkup(coûtFournisseurImage, model, 'image') —
// le cas FACILE (settle exact, pas d'estimation). C'est là qu'est la marge.
