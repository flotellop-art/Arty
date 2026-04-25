import { useState } from 'react'
import { useTokenUsage } from '../../hooks/useTokenUsage'

export function TokenUsageBar() {
  const { usage, formattedCost, formattedInput, formattedOutput, reset } = useTokenUsage()
  const [open, setOpen] = useState(false)

  return (
    <div className="px-5 py-3 border-t border-theme-border">
      {/* Header — kicker + cost, click to toggle detail */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent shrink-0">
            <path
              d="M1 7h2.5l1.5-4 2 8 1.5-4 1 2H13"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <span className="font-sans text-[10px] uppercase tracking-kicker text-theme-muted">
            Tokens ce mois —
          </span>
          <span className="font-mono text-[13px] font-semibold text-theme-accent shrink-0">
            {formattedCost}
          </span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`text-theme-muted transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Detail — editorial: dotted rules, mono numbers, no heavy cards */}
      {open && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-baseline justify-between border-b border-dotted border-theme-border pb-1">
            <span className="font-sans text-[10px] uppercase tracking-kicker text-theme-muted">
              Requêtes
            </span>
            <span className="font-mono text-sm text-theme-ink">{usage.requestCount}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-dotted border-theme-border pb-1">
            <span className="font-sans text-[10px] uppercase tracking-kicker text-theme-muted">
              Input
            </span>
            <span className="font-mono text-sm text-theme-ink">{formattedInput}</span>
          </div>
          <div className="flex items-baseline justify-between pb-1">
            <span className="font-sans text-[10px] uppercase tracking-kicker text-theme-muted">
              Output
            </span>
            <span className="font-mono text-sm text-theme-ink">{formattedOutput}</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              reset()
            }}
            className="font-sans text-[10px] uppercase tracking-kicker text-theme-muted hover:text-theme-accent transition-colors mt-1"
          >
            Réinitialiser
          </button>
        </div>
      )}
    </div>
  )
}
