import type { PriceResult } from '../../types/browser'
import { Tag } from '../shared/editorial'

interface PriceTableProps {
  query: string
  results: PriceResult[]
}

export function PriceTable({ query, results }: PriceTableProps) {
  return (
    <div
      className="overflow-hidden my-3"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderRadius: 2,
      }}
    >
      <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--arty-ink)' }}>
        <Tag accent>◈ Comparatif prix</Tag>
        <h3 className="font-display italic text-[16px] font-medium mt-1" style={{ color: 'var(--arty-ink)' }}>
          {query}
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--arty-line)', backgroundColor: 'var(--arty-card-hi)' }}>
              <th className="text-left px-4 py-2 text-[10px] tracking-[0.15em] uppercase font-sans font-semibold" style={{ color: 'var(--arty-muted)' }}>
                Fournisseur
              </th>
              <th className="text-left px-4 py-2 text-[10px] tracking-[0.15em] uppercase font-sans font-semibold" style={{ color: 'var(--arty-muted)' }}>
                Produit
              </th>
              <th className="text-right px-4 py-2 text-[10px] tracking-[0.15em] uppercase font-sans font-semibold" style={{ color: 'var(--arty-muted)' }}>
                Prix
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} style={{ borderBottom: i < results.length - 1 ? '1px dotted var(--arty-line)' : 'none' }}>
                <td className="px-4 py-2 font-display italic" style={{ color: 'var(--arty-accent)' }}>{r.source}</td>
                <td className="px-4 py-2 font-serif" style={{ color: 'var(--arty-ink)' }}>{r.product}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: 'var(--arty-ink)' }}>{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2" style={{ borderTop: '1px solid var(--arty-line)' }}>
        <p className="text-[11px] font-serif italic" style={{ color: 'var(--arty-muted)' }}>
          Prix indicatifs — vérifiez sur les sites fournisseurs.
        </p>
      </div>
    </div>
  )
}
