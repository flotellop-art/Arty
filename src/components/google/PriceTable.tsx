import type { PriceResult } from '../../types/browser'

interface PriceTableProps {
  query: string
  results: PriceResult[]
}

export function PriceTable({ query, results }: PriceTableProps) {
  return (
    <div className="bg-theme-surface rounded-xl border border-theme-border shadow-sm overflow-hidden my-2">
      <div className="bg-blue-50 px-4 py-3 border-b border-theme-border">
        <h3 className="font-display text-theme-ink text-sm">
          Comparatif prix : {query}
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-theme-ink/[0.03] border-b border-theme-border">
              <th className="text-left px-4 py-2 font-medium text-theme-ink/80">Fournisseur</th>
              <th className="text-left px-4 py-2 font-medium text-theme-ink/80">Produit</th>
              <th className="text-right px-4 py-2 font-medium text-theme-ink/80">Prix</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-theme-border last:border-0">
                <td className="px-4 py-2 font-medium text-theme-accent">{r.source}</td>
                <td className="px-4 py-2 text-theme-ink">{r.product}</td>
                <td className="px-4 py-2 text-right font-medium text-theme-ink">{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-theme-border">
        <p className="text-xs text-theme-muted">
          Prix indicatifs — vérifiez sur les sites fournisseurs
        </p>
      </div>
    </div>
  )
}
