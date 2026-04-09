import { useState, useEffect, useCallback } from 'react'
import { getUsage, resetUsage, formatCost, formatTokens, type TokenUsage } from '../services/tokenTracker'

export function useTokenUsage() {
  const [usage, setUsage] = useState<TokenUsage>(getUsage)

  // Refresh every 2 seconds (to catch updates from API calls)
  useEffect(() => {
    const interval = setInterval(() => {
      setUsage(getUsage())
    }, 2000)
    return () => clearInterval(interval)
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
