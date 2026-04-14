import { useEffect, useState } from 'react'
import {
  getMemoryHistory,
  revertLastChange,
  clearMemoryHistory,
  type MemoryHistoryEntry,
} from '../../services/memoryHistory'

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-serif text-lg font-semibold text-bubble-user">📜 Historique mémoire</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Fermer">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Aucun changement enregistré</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-bubble-user">
                      {e.action} · {e.category}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {new Date(e.timestamp).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 break-words">{e.details}</p>
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => handleUndo(e.category)}
                      className="text-[11px] px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700"
                    >
                      ↩ Annuler ce changement
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {entries.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100">
            <button
              onClick={() => {
                clearMemoryHistory()
                setEntries([])
              }}
              className="w-full text-xs py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"
            >
              Effacer tout l'historique
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
