import type { PriceResult } from '../../types/browser'

interface PriceTableProps {
  query: string
  results: PriceResult[]
}

export function PriceTable({ query, results }: PriceTableProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden my-2">
      <div className="bg-blue-50 px-4 py-3 border-b border-gray-100">
        <h3 className="font-serif font-semibold text-bubble-user text-sm">
          Comparatif prix : {query}
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-2 font-medium text-gray-600">Fournisseur</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Produit</th>
              <th className="text-right px-4 py-2 font-medium text-gray-600">Prix</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 font-medium text-accent">{r.source}</td>
                <td className="px-4 py-2 text-bubble-user">{r.product}</td>
                <td className="px-4 py-2 text-right font-medium text-bubble-user">{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          Prix indicatifs — vérifiez sur les sites fournisseurs
        </p>
      </div>
    </div>
  )
}
