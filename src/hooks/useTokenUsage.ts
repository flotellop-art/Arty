import { useState, useEffect, useCallback } from 'react'
import { getUsage, resetUsage, formatCost, formatTokens, type TokenUsage } from '../services/tokenTracker'

export function useTokenUsage() {
  const [usage, setUsage] = useState<TokenUsage>(getUsage)

  useEffect(() => {
    const handler = (e: Event) => {
      setUsage((e as CustomEvent<TokenUsage>).detail)
    }
    window.addEventListener('token-usage-updated', handler)
    return () => window.removeEventListener('token-usage-updated', handler)
  }, [])

  const reset = useCallback(() => {
    setUsage(resetUsage())
  }, [])

  return {
    usage,
    reset,
    formattedCost: formatCost(usage.totalCost),
    formattedInput: formatTokens(usage.inputTokens),
    formattedOutput: formatTokens(usage.outputTokens),
  }
}
