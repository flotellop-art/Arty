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
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden my-2 shadow-sm">
      {/* Header */}
      <div className="bg-accent/5 px-4 py-3 border-b border-gray-100">
        <h3 className="font-serif font-semibold text-bubble-user text-sm">{title}</h3>
        {client && <p className="text-xs text-gray-500 mt-0.5">{client}</p>}
      </div>

      {/* Lines */}
      <div className="px-4 py-2">
        {lines.map((line, i) => (
          <div key={i} className="flex justify-between py-1.5 border-b border-gray-50 last:border-0 text-sm">
            <div className="flex-1">
              <span className="text-bubble-user">{line.description}</span>
              {line.surface && (
                <span className="text-gray-400 ml-1.5 text-xs">{line.surface}</span>
              )}
            </div>
            <span className="font-medium text-bubble-user ml-4">{line.price}</span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-sm">
        <div className="flex justify-between py-0.5">
          <span className="text-gray-500">Total HT</span>
          <span className="text-bubble-user">{totalHT}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="text-gray-500">TVA</span>
          <span className="text-bubble-user">{tva}</span>
        </div>
        <div className="flex justify-between py-0.5 font-semibold">
          <span className="text-bubble-user">Total TTC</span>
          <span className="text-accent">{totalTTC}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3 border-t border-gray-100">
        <button className="flex-1 py-2 rounded-lg border border-accent text-accent text-sm font-medium hover:bg-accent/5 transition-colors">
          PDF
        </button>
        <button className="flex-1 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors">
          Envoyer
        </button>
      </div>
    </div>
  )
}

export type { QuoteCardProps, QuoteLine }
