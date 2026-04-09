const STORAGE_KEY = 'arty-token-usage'

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

const INIT_KEY = 'arty-token-init-v2'

export function getUsage(): TokenUsage {
  try {
    // Force re-init once to include historical data
    if (!localStorage.getItem(INIT_KEY)) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.setItem(INIT_KEY, '1')
      return resetUsage()
    }

    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      const usage = JSON.parse(data) as TokenUsage
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
  // Initialize with historical usage from before tracker was installed
  const usage: TokenUsage = {
    inputTokens: 1362217,
    outputTokens: 15357,
    totalCost: 0,
    requestCount: 0,
    lastReset: '2026-04',
  }
  usage.totalCost = (usage.inputTokens * INPUT_PRICE_PER_M + usage.outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000
  localStorage.setItem(STORAGE_KEY, JSON.stringify(usage))
  return usage
}

export function addUsage(inputTokens: number, outputTokens: number): TokenUsage {
  const usage = getUsage()
  usage.inputTokens += inputTokens
  usage.outputTokens += outputTokens
  usage.requestCount += 1
  usage.totalCost = (usage.inputTokens * INPUT_PRICE_PER_M + usage.outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000
  localStorage.setItem(STORAGE_KEY, JSON.stringify(usage))
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
