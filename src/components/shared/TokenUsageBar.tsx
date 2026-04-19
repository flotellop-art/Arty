import { useTokenUsage } from '../../hooks/useTokenUsage'

export function TokenUsageBar() {
  const { usage, formattedCost, formattedInput, formattedOutput, reset } = useTokenUsage()

  return (
    <div className="px-5 py-3 border-t border-theme-border">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-theme-muted">Tokens ce mois</span>
        <button
          onClick={reset}
          className="text-xs text-theme-muted/70 hover:text-red-500 transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-theme-muted/70">Requetes</span>
          <span className="text-theme-ink font-medium">{usage.requestCount}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-theme-muted/70">Input</span>
          <span className="text-theme-ink">{formattedInput}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-theme-muted/70">Output</span>
          <span className="text-theme-ink">{formattedOutput}</span>
        </div>
        <div className="flex justify-between text-xs pt-1 border-t border-theme-border">
          <span className="text-theme-muted font-medium">Cout estimé</span>
          <span className="text-theme-accent font-semibold">{formattedCost}</span>
        </div>
      </div>
    </div>
  )
}
