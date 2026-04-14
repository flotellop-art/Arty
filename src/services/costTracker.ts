/**
 * Cost tracker (Feature 13) — per-model token + cost breakdown.
 *
 * Prices (USD per 1M tokens):
 *   - claude:  $3 in  / $15 out
 *   - openai:  $2.5 in / $10 out
 *   - gemini:  $1.25 in / $5 out
 *   - mistral: $2 in  / $6 out
 */

import * as scoped from './scopedStorage'

export interface ModelCost {
  model: string
  inputTokens: number
  outputTokens: number
  cost: number
}

const KEY = 'cost-breakdown'

const PRICES: Record<string, { in: number; out: number }> = {
  claude:  { in: 3.0,  out: 15.0 },
  openai:  { in: 2.5,  out: 10.0 },
  gemini:  { in: 1.25, out: 5.0 },
  mistral: { in: 2.0,  out: 6.0 },
}

interface StoredData {
  month: string
  models: Record<string, ModelCost>
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

function loadData(): StoredData {
  const stored = scoped.getJSON<StoredData>(KEY)
  const month = getCurrentMonth()
  if (!stored || stored.month !== month) {
    return { month, models: {} }
  }
  return stored
}

function saveData(data: StoredData): void {
  scoped.setJSON(KEY, data)
  window.dispatchEvent(new CustomEvent('cost-updated'))
}

export function getModelCosts(): Record<string, ModelCost> {
  return loadData().models
}

export function getCost(): number {
  const models = loadData().models
  return Object.values(models).reduce((acc, c) => acc + c.cost, 0)
}

export function addTokens(modelKey: string, inputTokens: number, outputTokens: number): void {
  const key = (modelKey || 'claude').toLowerCase()
  const prices = PRICES[key] || PRICES.claude!
  const data = loadData()
  const existing = data.models[key] || { model: key, inputTokens: 0, outputTokens: 0, cost: 0 }
  existing.inputTokens += inputTokens
  existing.outputTokens += outputTokens
  existing.cost = (existing.inputTokens * prices.in + existing.outputTokens * prices.out) / 1_000_000
  data.models[key] = existing
  saveData(data)
}

export function resetCosts(): void {
  saveData({ month: getCurrentMonth(), models: {} })
}
