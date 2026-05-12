interface QuoteLine {
  description: string
  surface?: string
  price: string
}

interface QuoteCardProps {
  title: string
  client?: string
  lines: QuoteLine[]
  totalHT: string
  tva: string
  totalTTC: string
}

export function QuoteCard({ title, client, lines, totalHT, tva, totalTTC }: QuoteCardProps) {
  return (
    <div className="bg-theme-surface border border-theme-border rounded-xl overflow-hidden my-2 shadow-sm">
      {/* Header */}
      <div className="bg-theme-accent/5 px-4 py-3 border-b border-theme-border">
        <h3 className="font-display text-theme-ink text-sm">{title}</h3>
        {client && <p className="text-xs text-theme-muted mt-0.5">{client}</p>}
      </div>

      {/* Lines */}
      <div className="px-4 py-2">
        {lines.map((line, i) => (
          <div key={i} className="flex justify-between py-1.5 border-b border-theme-border last:border-0 text-sm">
            <div className="flex-1">
              <span className="text-theme-ink">{line.description}</span>
              {line.surface && (
                <span className="text-theme-muted ml-1.5 text-xs">{line.surface}</span>
              )}
            </div>
            <span className="font-medium text-theme-ink ml-4">{line.price}</span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-4 py-2 bg-theme-ink/[0.03] border-t border-theme-border text-sm">
        <div className="flex justify-between py-0.5">
          <span className="text-theme-muted">Total HT</span>
          <span className="text-theme-ink">{totalHT}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-theme-muted">TVA</span>
          <span className="text-theme-ink">{tva}</span>
        </div>
        <div className="flex justify-between py-0.5 font-semibold">
          <span className="text-theme-ink">Total TTC</span>
          <span className="text-theme-accent">{totalTTC}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3 border-t border-theme-border">
        <button className="flex-1 py-2 rounded-lg border border-theme-accent text-theme-accent text-sm font-medium hover:bg-theme-accent/5 transition-colors">
          PDF
        </button>
        <button className="flex-1 py-2 rounded-lg bg-theme-accent text-theme-bg text-sm font-medium hover:opacity-90 transition-colors">
          Envoyer
        </button>
      </div>
    </div>
  )
}

export type { QuoteCardProps, QuoteLine }
