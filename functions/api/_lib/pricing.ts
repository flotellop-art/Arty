// Tarifs officiels des providers (USD par million de tokens, sauf indication).
// Utilisés par trackUsage pour calculer le coût réel à partir des tokens
// parsés dans les réponses streaming. Les prix sont indicatifs : les factures
// officielles restent Anthropic Console / OpenAI Platform / Mistral / Google AI.
//
// Mettre à jour quand les providers changent leurs tarifs.

export interface ModelPricing {
  /** USD per 1M input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
  /** USD per 1M cache-read tokens (prompt caching). 0 if non applicable. */
  cacheRead?: number
  /** USD per 1M cache-creation tokens. 0 if non applicable. */
  cacheCreation?: number
  /** USD per audio second (Whisper). */
  audioPerSec?: number
  /** USD per generated image (gpt-image-1). */
  imagePerUnit?: number
}

// Toutes les valeurs sont celles d'avril 2026. À ajuster si les providers
// publient de nouveaux tarifs.
const PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-opus-4-7': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  'claude-opus-4-8': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 }, // GA 28/05/2026, même tarif
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 },

  // OpenAI (transcription)
  'whisper-1': { input: 0, output: 0, audioPerSec: 0.006 / 60 }, // $0.006 / minute

  // Mistral (transcription EU — dictée des conversations euOnly)
  // Facturé à la minute ; les prompt/completion_tokens de la réponse ne sont
  // PAS comptés (le tarif officiel est uniquement par minute d'audio).
  'voxtral-mini-latest': { input: 0, output: 0, audioPerSec: 0.003 / 60 }, // $0.003 / minute

  // OpenAI (chat, avril 2026)
  // GPT-5.5 sorti le 23/04/2026 — tarif officiel OpenAI $5 input / $30 output.
  // -60% hallucinations vs GPT-5 selon OpenAI. Défault dans openaiClient.ts.
  'gpt-5.5': { input: 5, output: 30 },
  'gpt-5.5-mini': { input: 0.5, output: 3 },
  // GPT-5 et dérivés (ancienne génération, conservés pour BYOK + fallback)
  'gpt-5': { input: 5, output: 20 },
  'gpt-5-mini': { input: 0.5, output: 2 },
  'gpt-5-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  // Génération d'images (P1.3). Coût fixe par image (qualité medium 1024²
  // ≈ $0.04). Pas de tokens — le coût passe par imagePerUnit.
  'gpt-image-1': { input: 0, output: 0, imagePerUnit: 0.04 },
  // FLUX (Black Forest Labs) — coût par image 1024² (P1.3-FLUX).
  'flux-2-klein-9b': { input: 0, output: 0, imagePerUnit: 0.015 },
  'flux-2-pro': { input: 0, output: 0, imagePerUnit: 0.03 },

  // Mistral (Small déprécié mai 2026, Medium 3.5 est le standard)
  'mistral-large-latest': { input: 2, output: 6 },
  'mistral-medium-latest': { input: 0.4, output: 2 },
  'codestral-latest': { input: 0.2, output: 0.6 },

  // Google Gemini
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.31 },
  // gemini-2.5-flash — défaut CHAT depuis juin 2026 (cf. geminiClient.ts).
  // Tarif GA réel $0.30/$2.50 (source ai.google.dev/gemini-api/docs/pricing).
  // L'ancienne valeur $0.075/$0.30 était le tarif preview/lite et sous-estimait
  // ~4-8× le coût réel — bug de tracking corrigé indépendamment du switch.
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.075 },
  'gemini-2.5-flash-lite': { input: 0.04, output: 0.15 },
  // Gemini Flash. `gemini-3.5-flash` (GA, modèle réellement servi cf.
  // geminiClient.ts) : $1.50/$9, cache $0.15 — source ai.google.dev/gemini-api/
  // docs/pricing. ATTENTION : ~3× plus cher que le preview. Le preview
  // `gemini-3-flash-preview` ($0.50/$3) et l'ancien nom GA jamais sorti
  // `gemini-3-flash` sont gardés comme alias pour les coûts historiques.
  'gemini-3.5-flash': { input: 1.5, output: 9, cacheRead: 0.15 },
  'gemini-3-flash': { input: 0.5, output: 3 },
  'gemini-3-flash-preview': { input: 0.5, output: 3 },
}

/** Fallback pour les modèles non recensés — tarif pessimiste style Opus. */
const FALLBACK_PRICING: ModelPricing = { input: 3, output: 15, cacheRead: 0.3 }

export function getPricing(model: string): ModelPricing {
  if (PRICING[model]) return PRICING[model]
  // Fallback via préfixe (ex: "claude-sonnet-latest" → claude-sonnet-4-6)
  const prefix = model.split(/[-@.]/)[0] ?? ''
  if (prefix === 'claude') return PRICING['claude-sonnet-4-6'] ?? FALLBACK_PRICING
  if (prefix === 'gpt') return PRICING['gpt-5.5-mini'] ?? FALLBACK_PRICING
  if (prefix === 'gemini') return PRICING['gemini-2.5-flash'] ?? FALLBACK_PRICING
  if (prefix === 'mistral') return PRICING['mistral-medium-latest'] ?? FALLBACK_PRICING
  if (prefix === 'flux') return PRICING['flux-2-klein-9b'] ?? FALLBACK_PRICING
  return FALLBACK_PRICING
}

export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  audioSeconds: number
  /** Nombre d'images générées (gpt-image-1). Optionnel, défaut 0. */
  images?: number
}

/** Coût en micro-USD (10^-6 USD) — évite les floats dans D1. */
export function computeCostMicroUsd(model: string, usage: UsageTokens): number {
  const p = getPricing(model)
  const MTOK = 1_000_000
  // Chaque composante convertie en USD, puis en micro-USD.
  const cost =
    (usage.inputTokens * p.input) / MTOK +
    (usage.outputTokens * p.output) / MTOK +
    (usage.cacheReadTokens * (p.cacheRead ?? 0)) / MTOK +
    (usage.cacheCreationTokens * (p.cacheCreation ?? 0)) / MTOK +
    usage.audioSeconds * (p.audioPerSec ?? 0) +
    (usage.images ?? 0) * (p.imagePerUnit ?? 0)
  return Math.round(cost * 1_000_000)
}
