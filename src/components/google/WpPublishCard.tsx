import { useState } from 'react'
import { Tag } from '../shared/editorial'

interface WpPublishCardProps {
  title: string
  content: string
  onConfirm: (status: 'publish' | 'draft') => void
  onCancel: () => void
  isLoading: boolean
}

export function WpPublishCard({ title, content, onConfirm, onCancel, isLoading }: WpPublishCardProps) {
  const [confirmed, setConfirmed] = useState(false)

  const preview = {
    backgroundColor: 'var(--arty-card-hi)',
    color: 'var(--arty-ink)',
    border: '1px solid var(--arty-line)',
    borderRadius: 2,
  } as const

  return (
    <div
      className="overflow-hidden my-3"
      style={{
        backgroundColor: 'var(--arty-card)',
        border: '1px solid var(--arty-line)',
        borderRadius: 2,
      }}
    >
      <div className="px-4 pt-3 pb-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--arty-ink)' }}>
        <Tag accent>◈ Publication WordPress</Tag>
        <button
          onClick={onCancel}
          className="text-[10px] tracking-[0.14em] uppercase font-sans font-semibold"
          style={{ color: 'var(--arty-muted)' }}
        >
          Annuler
        </button>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div>
          <label className="text-[10px] tracking-[0.15em] uppercase font-sans font-semibold block mb-0.5" style={{ color: 'var(--arty-muted)' }}>
            Titre
          </label>
          <p className="font-display text-[15px] px-3 py-2" style={preview}>
            {title}
          </p>
        </div>
        <div>
          <label className="text-[10px] tracking-[0.15em] uppercase font-sans font-semibold block mb-0.5" style={{ color: 'var(--arty-muted)' }}>
            Extrait
          </label>
          <p className="font-serif italic text-[13px] px-3 py-2 leading-[1.5]" style={preview}>
            {content.slice(0, 300)}{content.length > 300 ? '…' : ''}
          </p>
        </div>
      </div>

      {confirmed && (
        <div
          className="mx-4 mb-2 px-3 py-2 text-[13px] font-serif italic"
          style={{
            backgroundColor: 'var(--arty-accent-glow)',
            borderLeft: '2px solid var(--arty-accent)',
            color: 'var(--arty-ink-soft)',
            borderRadius: 2,
          }}
        >
          Confirmer la publication sur WordPress ?
        </div>
      )}

      <div className="flex gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--arty-line)' }}>
        <button
          onClick={() => { if (confirmed) onConfirm('draft'); else setConfirmed(true) }}
          disabled={isLoading}
          className="flex-1 py-2 text-[13px] font-serif italic disabled:opacity-50"
          style={{ border: '1px solid var(--arty-line)', color: 'var(--arty-ink)', borderRadius: 2 }}
        >
          {isLoading ? '…' : 'Brouillon'}
        </button>
        <button
          onClick={() => { if (confirmed) onConfirm('publish'); else setConfirmed(true) }}
          disabled={isLoading}
          className="flex-1 py-2 text-[13px] font-serif italic disabled:opacity-50"
          style={{
            backgroundColor: confirmed ? 'var(--arty-accent)' : 'var(--arty-ink)',
            color: 'var(--arty-bg)',
            borderRadius: 2,
          }}
        >
          {isLoading ? 'Publication…' : confirmed ? 'Confirmer →' : 'Publier →'}
        </button>
      </div>
    </div>
  )
}
