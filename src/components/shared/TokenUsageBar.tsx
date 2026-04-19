import { useTokenUsage } from '../../hooks/useTokenUsage'
import { Tag } from './editorial'

export function TokenUsageBar() {
  const { usage, formattedCost, formattedInput, formattedOutput, reset } = useTokenUsage()

  return (
    <div className="px-5 py-3" style={{ borderTop: '1px solid var(--arty-line)' }}>
      <div className="flex items-center justify-between mb-2">
        <Tag>Tokens · ce mois</Tag>
        <button
          onClick={reset}
          className="text-[10px] tracking-[0.15em] uppercase font-sans font-semibold"
          style={{ color: 'var(--arty-muted)' }}
        >
          Reset
        </button>
      </div>

      <div className="space-y-1 text-[12px]">
        <div className="flex justify-between">
          <span className="font-serif italic" style={{ color: 'var(--arty-muted)' }}>Requêtes</span>
          <span className="font-mono" style={{ color: 'var(--arty-ink)' }}>{usage.requestCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-serif italic" style={{ color: 'var(--arty-muted)' }}>Input</span>
          <span className="font-mono" style={{ color: 'var(--arty-ink)' }}>{formattedInput}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-serif italic" style={{ color: 'var(--arty-muted)' }}>Output</span>
          <span className="font-mono" style={{ color: 'var(--arty-ink)' }}>{formattedOutput}</span>
        </div>
        <div
          className="flex justify-between pt-1 mt-1"
          style={{ borderTop: '1px dotted var(--arty-line)' }}
        >
          <span className="font-display italic" style={{ color: 'var(--arty-ink)' }}>Coût estimé</span>
          <span className="font-display italic font-semibold" style={{ color: 'var(--arty-accent)' }}>{formattedCost}</span>
        </div>
      </div>
    </div>
  )
}
