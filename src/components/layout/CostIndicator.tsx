import { useEffect, useState } from 'react'
import { getCost, getModelCosts, type ModelCost } from '../../services/costTracker'

export function CostIndicator() {
  const [cost, setCost] = useState(getCost())
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    const refresh = () => setCost(getCost())
    window.addEventListener('cost-updated', refresh)
    return () => window.removeEventListener('cost-updated', refresh)
  }, [])

  const color = cost > 0.5 ? 'text-red-500' : cost > 0.1 ? 'text-yellow-600' : 'text-green-600'

  return (
    <>
      <button
        onClick={() => setShowDetails(true)}
        className={`px-2 py-1 text-[11px] font-mono font-semibold rounded-md hover:bg-theme-ink/5 transition-colors ${color}`}
        title="Coût API estimé (ce mois)"
        aria-label="Coût API"
      >
        ~${cost.toFixed(2)}
      </button>
      {showDetails && <CostModal onClose={() => setShowDetails(false)} />}
    </>
  )
}

function CostModal({ onClose }: { onClose: () => void }) {
  const [costs, setCosts] = useState<Record<string, ModelCost>>(getModelCosts)
  const total = Object.values(costs).reduce((acc, c) => acc + c.cost, 0)
  const totalIn = Object.values(costs).reduce((acc, c) => acc + c.inputTokens, 0)
  const totalOut = Object.values(costs).reduce((acc, c) => acc + c.outputTokens, 0)

  useEffect(() => {
    const refresh = () => setCosts(getModelCosts())
    window.addEventListener('cost-updated', refresh)
    return () => window.removeEventListener('cost-updated', refresh)
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-ink/50" onClick={onClose}>
      <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="font-display text-lg text-theme-ink">💰 Coût API</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted" aria-label="Fermer">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <div className="mb-4 pb-4 border-b border-theme-border">
            <p className="text-[10px] uppercase tracking-wider text-theme-muted/70">Total ce mois-ci</p>
            <p className="text-3xl font-display font-medium text-theme-accent mt-1">${total.toFixed(4)}</p>
            <p className="text-xs text-theme-muted mt-1">
              {totalIn.toLocaleString()} tokens entrée · {totalOut.toLocaleString()} sortie
            </p>
          </div>

          <p className="text-[10px] uppercase tracking-wider text-theme-muted/70 mb-2">Par modèle</p>
          {Object.keys(costs).length === 0 ? (
            <p className="text-sm text-theme-muted/70 text-center py-4">Aucune utilisation ce mois-ci</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(costs).map(([model, c]) => (
                <li key={model} className="flex items-center justify-between text-sm">
                  <span className="text-theme-ink capitalize">{model}</span>
                  <div className="text-right">
                    <p className="font-mono font-semibold">${c.cost.toFixed(4)}</p>
                    <p className="text-[10px] text-theme-muted/70">
                      {c.inputTokens.toLocaleString()}↓ · {c.outputTokens.toLocaleString()}↑
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
