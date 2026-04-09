import { useTokenUsage } from '../../hooks/useTokenUsage'

export function TokenUsageBar() {
  const { usage, formattedCost, formattedInput, formattedOutput, reset } = useTokenUsage()

  return (
    <div className="px-5 py-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-500">Tokens ce mois</span>
        <button
          onClick={reset}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Requetes</span>
          <span className="text-bubble-user font-medium">{usage.requestCount}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Input</span>
          <span className="text-bubble-user">{formattedInput}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Output</span>
          <span className="text-bubble-user">{formattedOutput}</span>
        </div>
        <div className="flex justify-between text-xs pt-1 border-t border-gray-50">
          <span className="text-gray-500 font-medium">Cout estimé</span>
          <span className="text-accent font-semibold">{formattedCost}</span>
        </div>
      </div>
    </div>
  )
}
