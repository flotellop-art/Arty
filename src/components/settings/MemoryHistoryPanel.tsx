import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getMemoryHistory,
  revertLastChange,
  clearMemoryHistory,
  type MemoryHistoryEntry,
} from '../../services/memoryHistory'
import { getDateLocale } from '../../utils/formatDate'

interface Props {
  onClose: () => void
}

export function MemoryHistoryPanel({ onClose }: Props) {
  const { t } = useTranslation()
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-ink/50" onClick={onClose}>
      <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="font-display text-lg text-theme-ink">{t('memoryHistory.title')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted" aria-label={t('common.close')}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {entries.length === 0 ? (
            <p className="text-sm text-theme-muted text-center py-8">{t('memoryHistory.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="border border-theme-border rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-theme-ink">
                      {e.action} · {e.category}
                    </span>
                    <span className="text-[10px] text-theme-muted">
                      {new Date(e.timestamp).toLocaleString(getDateLocale())}
                    </span>
                  </div>
                  <p className="text-xs text-theme-ink/80 break-words">{e.details}</p>
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => handleUndo(e.category)}
                      className="text-[11px] px-2 py-1 rounded-md border border-theme-border hover:bg-theme-ink/[0.03] text-theme-ink/80"
                    >
                      {t('memoryHistory.undoChange')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {entries.length > 0 && (
          <div className="px-5 py-3 border-t border-theme-border">
            <button
              onClick={() => {
                clearMemoryHistory()
                setEntries([])
              }}
              className="w-full text-xs py-2 rounded-lg border border-theme-border hover:bg-theme-ink/[0.03] text-theme-muted"
            >
              {t('memoryHistory.clearAll')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
