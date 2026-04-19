import { useEffect, useState } from 'react'
import {
  getMemoryHistory,
  revertLastChange,
  clearMemoryHistory,
  type MemoryHistoryEntry,
} from '../../services/memoryHistory'
import { Tag, Rule, DotLine } from '../shared/editorial'

interface Props {
  onClose: () => void
}

export function MemoryHistoryPanel({ onClose }: Props) {
  const [entries, setEntries] = useState<MemoryHistoryEntry[]>([])

  useEffect(() => {
    setEntries(getMemoryHistory())
    const refresh = () => setEntries(getMemoryHistory())
    window.addEventListener('memory-history-updated', refresh)
    return () => window.removeEventListener('memory-history-updated', refresh)
  }, [])

  const handleUndo = async (category: string) => {
    await revertLastChange(category)
    setEntries(getMemoryHistory())
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col"
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          border: '1px solid var(--arty-line)',
          borderRadius: 4,
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Masthead */}
        <div className="px-5 pt-4 pb-2 flex items-center gap-3">
          <button
            onClick={onClose}
            className="text-[20px] leading-none"
            style={{ color: 'var(--arty-ink)' }}
            aria-label="Fermer"
          >
            ←
          </button>
          <Tag>Historique mémoire</Tag>
          <div className="flex-1" />
        </div>
        <Rule className="mx-5" />

        {/* Hero */}
        <div className="px-5 pt-3 pb-2">
          <h1 className="font-display text-[24px] leading-[1.05] font-light tracking-[-0.02em]">
            <span className="italic" style={{ color: 'var(--arty-accent)' }}>{entries.length}</span>
            <span className="ml-2">changement{entries.length > 1 ? 's' : ''}</span>
          </h1>
          <p className="font-serif italic text-[13px] mt-1" style={{ color: 'var(--arty-muted)' }}>
            Reviens en arrière si tu veux.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-3">
          {entries.length === 0 ? (
            <p
              className="font-serif italic text-[14px] text-center py-10"
              style={{ color: 'var(--arty-muted)' }}
            >
              Aucun changement enregistré pour l'instant.
            </p>
          ) : (
            <ul>
              {entries.map((e, i) => (
                <li key={e.id}>
                  <div className="py-3">
                    <div className="flex items-center justify-between mb-1">
                      <Tag accent>◈ {e.action} · {e.category}</Tag>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--arty-muted)' }}>
                        {new Date(e.timestamp).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <p className="font-serif text-[13px] leading-[1.45] break-words mt-1" style={{ color: 'var(--arty-ink-soft)' }}>
                      {e.details}
                    </p>
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => handleUndo(e.category)}
                        className="text-[11px] px-2 py-1 font-serif italic"
                        style={{
                          border: '1px solid var(--arty-line)',
                          color: 'var(--arty-ink-soft)',
                          borderRadius: 2,
                        }}
                      >
                        ↩ annuler
                      </button>
                    </div>
                  </div>
                  {i < entries.length - 1 && <DotLine />}
                </li>
              ))}
            </ul>
          )}
        </div>

        {entries.length > 0 && (
          <div className="px-5 py-3" style={{ borderTop: '1px solid var(--arty-line)' }}>
            <button
              onClick={() => {
                clearMemoryHistory()
                setEntries([])
              }}
              className="w-full py-2 text-[11px] tracking-[0.1em] uppercase font-sans font-semibold"
              style={{
                border: '1px solid var(--arty-line)',
                color: 'var(--arty-muted)',
                borderRadius: 2,
              }}
            >
              Effacer tout l'historique
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
