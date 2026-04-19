import { useState } from 'react'

interface WpPublishCardProps {
  title: string
  content: string
  onConfirm: (status: 'publish' | 'draft') => void
  onCancel: () => void
  isLoading: boolean
}

export function WpPublishCard({
  title,
  content,
  onConfirm,
  onCancel,
  isLoading,
}: WpPublishCardProps) {
  const [confirmed, setConfirmed] = useState(false)

  return (
    <div className="bg-theme-surface rounded-xl border border-theme-border shadow-sm overflow-hidden my-2">
      <div className="bg-purple-50 px-4 py-3 border-b border-theme-border flex items-center justify-between">
        <h3 className="font-display text-theme-ink text-sm">
          Publication WordPress
        </h3>
        <button
          onClick={onCancel}
          className="text-xs text-theme-muted/70 hover:text-red-500 transition-colors"
        >
          Annuler
        </button>
      </div>

      <div className="px-4 py-3 space-y-2">
        <div>
          <label className="text-xs text-theme-muted block mb-0.5">Titre</label>
          <p className="text-sm font-medium text-theme-ink bg-theme-ink/[0.03] rounded-lg px-3 py-2">
            {title}
          </p>
        </div>
        <div>
          <label className="text-xs text-theme-muted block mb-0.5">Extrait du contenu</label>
          <p className="text-sm text-theme-ink bg-theme-ink/[0.03] rounded-lg px-3 py-2 line-clamp-4 leading-relaxed">
            {content.slice(0, 300)}{content.length > 300 ? '...' : ''}
          </p>
        </div>
      </div>

      {confirmed && (
        <div className="mx-4 mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          Confirmez-vous la publication sur WordPress ?
        </div>
      )}

      <div className="flex gap-2 px-4 py-3 border-t border-theme-border">
        <button
          onClick={() => {
            if (confirmed) onConfirm('draft')
            else setConfirmed(true)
          }}
          disabled={isLoading}
          className="flex-1 py-2 rounded-lg border border-theme-border text-theme-ink/70 text-sm font-medium hover:bg-theme-ink/[0.03] transition-colors disabled:opacity-50"
        >
          {isLoading ? '...' : 'Brouillon'}
        </button>
        <button
          onClick={() => {
            if (confirmed) onConfirm('publish')
            else setConfirmed(true)
          }}
          disabled={isLoading}
          className={`flex-1 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
            confirmed ? 'bg-red-500 hover:bg-red-600' : 'bg-theme-accent hover:opacity-90'
          }`}
        >
          {isLoading ? 'Publication...' : confirmed ? 'Confirmer publication' : 'Publier'}
        </button>
      </div>
    </div>
  )
}
