import * as scoped from './scopedStorage'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalCost: number
  requestCount: number
  lastReset: string
}

// Sonnet 4.6 pricing
const INPUT_PRICE_PER_M = 3.0   // $3 per million input tokens
const OUTPUT_PRICE_PER_M = 15.0  // $15 per million output tokens

export function getUsage(): TokenUsage {
  try {
    const usage = scoped.getJSON<TokenUsage>('token-usage')
    if (usage) {
      // Reset if different month
      const now = new Date().toISOString().slice(0, 7) // YYYY-MM
      if (usage.lastReset !== now) {
        return resetUsage()
      }
      return usage
    }
  } catch {}
  return resetUsage()
}

export function resetUsage(): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
    requestCount: 0,
    lastReset: new Date().toISOString().slice(0, 7),
  }
  scoped.setJSON('token-usage', usage)
  return usage
}

export function addUsage(inputTokens: number, outputTokens: number): TokenUsage {
  const usage = getUsage()
  usage.inputTokens += inputTokens
  usage.outputTokens += outputTokens
  usage.requestCount += 1
  usage.totalCost = (usage.inputTokens * INPUT_PRICE_PER_M + usage.outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000
  scoped.setJSON('token-usage', usage)
  window.dispatchEvent(new CustomEvent('token-usage-updated', { detail: usage }))
  return usage
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return '< 0.01$'
  return cost.toFixed(2) + '$'
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) return (tokens / 1000).toFixed(1) + 'K'
  return (tokens / 1_000_000).toFixed(2) + 'M'
}
