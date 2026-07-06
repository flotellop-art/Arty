/**
 * Cost tracker — centralise le suivi des coûts d'usage IA en €.
 *
 * Tarifs : $ par 1M tokens, convertis en € via un taux fixe de 0.92.
 * Les chiffres sont stockés sous la clé "cost_history" (scopée par user)
 * et lus en synchrone via setJSON / getJSON — voir BUG 16, on garde
 * tout sync pour ne pas casser l'affichage du dashboard.
 */

import * as scoped from './scopedStorage'

// USD → EUR (taux fixe — pas besoin d'une précision boursière pour
// estimer un coût mensuel d'API).
export const EUR_PER_USD = 0.92

// $ par 1M tokens (input / output)
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5':  { input: 0.80,  output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00,  output: 15.00 }, // legacy — conservé pour les coûts historiques
  // Sonnet 5 : tarif durable $3/$15 (l'intro $2/$10 court jusqu'au 31/08/2026 —
  // on inscrit le tarif pérenne pour éviter une PR de re-pricing en septembre).
  // ⚠️ Tokenizer Sonnet 5 ~30% plus gourmand : coût par MESSAGE ~+30% à tarif égal.
  'claude-sonnet-5':   { input: 3.00,  output: 15.00 },
  'claude-opus-4-6':   { input: 15.00, output: 75.00 }, // legacy — conservé pour les coûts historiques
  'claude-opus-4-8':   { input: 15.00, output: 75.00 }, // opus actif (GA 28/05/2026, même tarif que 4.6/4.7)
  'gpt-5-mini':        { input: 0.40,  output: 1.60 },
  'gpt-5':             { input: 2.50,  output: 10.00 },
  // Défaut CHAT (gros volume) = gemini-2.5-flash, tarif GA réel $0.30/$2.50
  // (ai.google.dev). L'ancienne valeur $0.10/$0.40 était une estimation
  // intermédiaire qui sous-estimait le coût. Source primaire des montants =
  // serveur D1 (BUG 60) ; ce bucket sert au fallback BYOK/offline.
  'gemini-flash':      { input: 0.30,  output: 2.50 },
  // gemini-3.5-flash — moitié recherche du mode hybride uniquement. $1.50/$9.
  'gemini-flash-pro':  { input: 1.50,  output: 9.00 },
  'gemini-flash-lite': { input: 0.05,  output: 0.20 }, // gemini-3.1-flash-lite, gemini-2.5-flash-lite
  'gemini-pro':        { input: 1.25,  output: 5.00 },
  'mistral-small':     { input: 0.15,  output: 0.45 }, // Small 4 (mars 2026, multimodal+reasoning)
  // Medium 3.5 — aligné sur functions/api/_lib/pricing.ts ($0.40/$2.00).
  // L'ancienne valeur (1.50/7.50) surestimait ~3.75× les coûts Mistral du
  // dashboard local (audit Mistral 11 juin 2026). N'affecte que la
  // valorisation locale future ; le serveur D1 reste la source primaire
  // des montants (BUG 60).
  'mistral-medium':    { input: 0.40,  output: 2.00 },
  'mistral-large':     { input: 2.00,  output: 6.00 }, // Large 3 (décembre 2025, MoE)
}

export interface ModelStats {
  input_tokens: number
  output_tokens: number
  cost_eur: number
}

export interface MonthStats {
  total_eur: number
  by_model: Record<string, ModelStats>
  by_day: Record<string, number>
}

export interface AlertConfig {
  enabled: boolean
  amount_eur: number
  last_warned_month?: string
}

const STORAGE_KEY = 'cost_history'
const ALERT_KEY = 'cost_alert'

// ─── Model normalisation ──────────────────────────────────────────────────────
//
// Les clients hardcodent des IDs précis (ex. "mistral-large-latest",
// "gemini-3-flash-preview", "gpt-5.5") qui n'existent pas dans MODEL_COSTS.
// On les ramène à l'entrée tarifaire la plus proche pour ne pas perdre la
// trace du coût quand un nouveau modèle sort.

const MODEL_ALIASES: Record<string, string> = {
  'mistral-large-latest': 'mistral-large',
  'mistral-medium-latest': 'mistral-medium',
  'mistral-medium-3.5': 'mistral-medium',
  'mistral-small-latest': 'mistral-small',
  'mistral-small-4': 'mistral-small',
  'gemini-3.5-flash': 'gemini-flash-pro', // recherche hybride premium ($1.50/$9)
  'gemini-3.1-flash-lite': 'gemini-flash-lite',
  'gemini-3-flash': 'gemini-flash-pro',
  'gemini-3-flash-preview': 'gemini-flash-pro',
  'gemini-2.5-flash-lite': 'gemini-flash-lite',
  'gemini-2.5-flash': 'gemini-flash', // défaut chat éco ($0.30/$2.50)
  'gemini-2.5-pro': 'gemini-pro',
  'gemini-pro-latest': 'gemini-pro',
  // GPT-5.5 (sorti avril 2026) facturé au tarif gpt-5 en attendant qu'OpenAI
  // publie une grille séparée.
  'gpt-5.5': 'gpt-5',
  'gpt-5-turbo': 'gpt-5',
  'claude-sonnet-4-5': 'claude-sonnet-4-6',
  'claude-opus-4-5': 'claude-opus-4-6',
}

export function normaliseModel(model: string): string {
  if (MODEL_COSTS[model]) return model
  if (MODEL_ALIASES[model]) return MODEL_ALIASES[model] as string
  // Fallbacks par préfixe pour ne pas perdre les futurs modèles
  if (model.startsWith('claude-haiku')) return 'claude-haiku-4-5'
  if (model.startsWith('claude-sonnet')) return 'claude-sonnet-5'
  if (model.startsWith('claude-opus')) return 'claude-opus-4-8'
  if (model.startsWith('gpt-5-mini') || model.includes('mini')) return 'gpt-5-mini'
  if (model.startsWith('gpt-')) return 'gpt-5'
  if (model.startsWith('gemini') && model.includes('flash-lite')) return 'gemini-flash-lite'
  if (model.startsWith('gemini') && model.includes('flash')) return 'gemini-flash'
  if (model.startsWith('gemini')) return 'gemini-pro'
  if (model.startsWith('mistral') && model.includes('small')) return 'mistral-small'
  if (model.startsWith('mistral') && model.includes('medium')) return 'mistral-medium'
  if (model.startsWith('mistral') && model.includes('large')) return 'mistral-large'
  if (model.startsWith('ministral')) return 'mistral-small'
  if (model.startsWith('mistral')) return 'mistral-medium'
  return model
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Retourne le coût en € pour un modèle et un nombre de tokens. */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const normalized = normaliseModel(model)
  const rate = MODEL_COSTS[normalized]
  if (!rate) return 0
  const inputUsd = (inputTokens / 1_000_000) * rate.input
  const outputUsd = (outputTokens / 1_000_000) * rate.output
  return (inputUsd + outputUsd) * EUR_PER_USD
}

/** Formatte un montant en € : "< 0,01€" si < 0.005, sinon "0,03€". */
export function formatCost(euros: number): string {
  if (!isFinite(euros) || euros < 0) return '0,00€'
  if (euros < 0.005) return '< 0,01€'
  return `${euros.toFixed(2).replace('.', ',')}€`
}

/** Clé du mois courant (YYYY-MM) basée sur l'horloge locale. */
function currentMonthKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Clé du jour courant (YYYY-MM-DD) basée sur l'horloge locale. */
function currentDayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function readHistory(): Record<string, MonthStats> {
  return scoped.getJSON<Record<string, MonthStats>>(STORAGE_KEY) || {}
}

function writeHistory(history: Record<string, MonthStats>): void {
  scoped.setJSON(STORAGE_KEY, history)
}

/**
 * Incrémente les statistiques de coût pour le mois courant.
 * Pas d'await : doit pouvoir être appelé en fin de stream sans bloquer.
 */
export function recordUsage(
  model: string,
  inputTokens: number,
  outputTokens: number
): void {
  if ((!inputTokens && !outputTokens) || !model) return

  const cost = calculateCost(model, inputTokens, outputTokens)
  const normalized = normaliseModel(model)
  const monthKey = currentMonthKey()
  const dayKey = currentDayKey()

  const history = readHistory()
  const month: MonthStats = history[monthKey] || {
    total_eur: 0,
    by_model: {},
    by_day: {},
  }

  const current = month.by_model[normalized] || {
    input_tokens: 0,
    output_tokens: 0,
    cost_eur: 0,
  }
  current.input_tokens += inputTokens
  current.output_tokens += outputTokens
  current.cost_eur += cost
  month.by_model[normalized] = current

  month.by_day[dayKey] = (month.by_day[dayKey] || 0) + cost
  month.total_eur += cost

  history[monthKey] = month
  writeHistory(history)

  // Notifie les composants UI (CostIndicator, CostsScreen) pour qu'ils
  // rafraîchissent leurs chiffres immédiatement plutôt que d'attendre le
  // poll 60s ou un re-mount. Wrappé dans try-catch pour ne jamais casser
  // le tracking si on tourne dans un contexte sans `window` (tests, SSR).
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cost-updated'))
    }
  } catch {
    // Tracking ne doit jamais throw — ignore.
  }
}

/** Stats agrégées pour un mois. Retourne un objet vide si pas de données. */
export function getMonthStats(monthKey: string): MonthStats {
  const history = readHistory()
  return (
    history[monthKey] || {
      total_eur: 0,
      by_model: {},
      by_day: {},
    }
  )
}

/** Liste des mois ayant au moins une entrée, du plus récent au plus ancien. */
export function getAllMonthKeys(): string[] {
  const history = readHistory()
  return Object.keys(history).sort().reverse()
}

/** Clé du mois courant exposée pour l'UI. */
export function getCurrentMonthKey(): string {
  return currentMonthKey()
}

/** Clé du mois précédent au format YYYY-MM. */
export function getPreviousMonthKey(monthKey: string): string {
  const [yStr, mStr] = monthKey.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  if (!y || !m) return monthKey
  const prev = new Date(y, m - 2, 1)
  const py = prev.getFullYear()
  const pm = String(prev.getMonth() + 1).padStart(2, '0')
  return `${py}-${pm}`
}

/** Renvoie les N derniers jours (YYYY-MM-DD) du plus ancien au plus récent. */
export function getLastNDays(n: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    out.push(currentDayKey(d))
  }
  return out
}

/** Lit le coût d'un jour donné en cumulé tous mois confondus. */
export function getDailyCost(day: string): number {
  const history = readHistory()
  // Le jour appartient à un seul mois, mais on parcourt tous les mois pour
  // rester robuste si l'utilisateur change de fuseau.
  let total = 0
  for (const month of Object.values(history)) {
    if (month.by_day[day]) total += month.by_day[day] || 0
  }
  return total
}

// ─── Alerte de budget ─────────────────────────────────────────────────────────

export function getAlertConfig(): AlertConfig {
  return (
    scoped.getJSON<AlertConfig>(ALERT_KEY) || {
      enabled: false,
      amount_eur: 10,
    }
  )
}

export function setAlertConfig(config: AlertConfig): void {
  scoped.setJSON(ALERT_KEY, config)
}

/**
 * Renvoie un message d'alerte si le mois courant dépasse le seuil configuré
 * et que l'utilisateur n'a pas encore été averti pour ce mois. Marque le mois
 * comme averti côté storage pour éviter le spam à chaque lancement.
 */
export function checkBudgetAlert(): { triggered: boolean; spent: number; limit: number } | null {
  const cfg = getAlertConfig()
  if (!cfg.enabled || !cfg.amount_eur) return null
  const monthKey = currentMonthKey()
  const spent = getMonthStats(monthKey).total_eur
  if (spent < cfg.amount_eur) return null
  if (cfg.last_warned_month === monthKey) return null
  setAlertConfig({ ...cfg, last_warned_month: monthKey })
  return { triggered: true, spent, limit: cfg.amount_eur }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

/**
 * Construit un CSV de l'usage agrégé par mois et par modèle.
 * Format : date (mois),modele,tokens_input,tokens_output,cout_eur
 */
export function buildCSV(): string {
  const history = readHistory()
  const rows: string[] = ['date,modele,tokens_input,tokens_output,cout_eur']
  const months = Object.keys(history).sort()
  for (const month of months) {
    const stats = history[month]
    if (!stats) continue
    const models = Object.keys(stats.by_model).sort()
    for (const modelId of models) {
      const m = stats.by_model[modelId]
      if (!m) continue
      rows.push(
        [
          month,
          modelId,
          String(m.input_tokens),
          String(m.output_tokens),
          m.cost_eur.toFixed(4),
        ].join(',')
      )
    }
  }
  return rows.join('\n')
}
