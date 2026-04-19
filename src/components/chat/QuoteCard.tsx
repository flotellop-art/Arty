import { Tag, DotLine } from '../shared/editorial'

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
    <div
      className="overflow-hidden my-3"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderRadius: 2,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
      }}
    >
      {/* Masthead devis */}
      <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--arty-ink)' }}>
        <Tag accent>◈ Devis</Tag>
        <h3 className="font-display text-[17px] font-medium mt-1" style={{ color: 'var(--arty-ink)', letterSpacing: '-0.01em' }}>
          {title}
        </h3>
        {client && (
          <p className="text-[12px] mt-0.5 font-serif italic" style={{ color: 'var(--arty-muted)' }}>
            {client}
          </p>
        )}
      </div>

      {/* Lines */}
      <div className="px-4 py-2">
        {lines.map((line, i) => (
          <div key={i}>
            <div className="flex justify-between py-2 text-[14px] items-baseline">
              <div className="flex-1 min-w-0">
                <span className="font-serif" style={{ color: 'var(--arty-ink)' }}>
                  {line.description}
                </span>
                {line.surface && (
                  <span className="ml-1.5 text-[11px] font-mono" style={{ color: 'var(--arty-muted)' }}>
                    {line.surface}
                  </span>
                )}
              </div>
              <span className="font-mono font-semibold ml-4" style={{ color: 'var(--arty-ink)' }}>
                {line.price}
              </span>
            </div>
            {i < lines.length - 1 && <DotLine />}
          </div>
        ))}
      </div>

      {/* Totals */}
      <div
        className="px-4 py-2 text-[13px]"
        style={{ backgroundColor: 'var(--arty-card-hi)', borderTop: '1px solid var(--arty-line)' }}
      >
        <div className="flex justify-between py-0.5">
          <span className="font-serif italic" style={{ color: 'var(--arty-muted)' }}>Total HT</span>
          <span className="font-mono" style={{ color: 'var(--arty-ink)' }}>{totalHT}</span>
        </div>
        <div className="flex justify-between py-0.5">
          <span className="font-serif italic" style={{ color: 'var(--arty-muted)' }}>TVA</span>
          <span className="font-mono" style={{ color: 'var(--arty-ink)' }}>{tva}</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="font-display font-medium" style={{ color: 'var(--arty-ink)' }}>Total TTC</span>
          <span className="font-display italic text-[16px]" style={{ color: 'var(--arty-accent)' }}>{totalTTC}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--arty-line)' }}>
        <button
          className="flex-1 py-2 font-serif italic text-[13px]"
          style={{ border: '1px solid var(--arty-accent)', color: 'var(--arty-accent)', borderRadius: 2 }}
        >
          PDF
        </button>
        <button
          className="flex-1 py-2 font-serif italic text-[13px]"
          style={{ backgroundColor: 'var(--arty-accent)', color: 'var(--arty-bg)', borderRadius: 2 }}
        >
          Envoyer →
        </button>
      </div>
    </div>
  )
}

export type { QuoteCardProps, QuoteLine }
