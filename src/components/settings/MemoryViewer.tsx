import { memo, useEffect, useState, useCallback } from 'react'
import { readAllMemory, updateMemory } from '../../services/memoryService'
import type { MemoryData } from '../../services/memoryService'

interface Props {
  onClose: () => void
}

type Tab = 'profil' | 'clients' | 'chantiers' | 'notes'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'profil', label: 'Profil', icon: '👤' },
  { key: 'clients', label: 'Clients', icon: '🏠' },
  { key: 'chantiers', label: 'Chantiers', icon: '🔧' },
  { key: 'notes', label: 'Notes', icon: '📝' },
]

function MemoryViewerInner({ onClose }: Props) {
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('profil')
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    readAllMemory()
      .then((data) => {
        setMemory(data)
        setEditValue(JSON.stringify(data['profil'], null, 2))
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!memory) return
    const val = memory[activeTab]
    setEditValue(JSON.stringify(val, null, 2))
    setSaved(false)
  }, [activeTab, memory])

  const handleSave = useCallback(async () => {
    if (!memory) return
    setSaving(true)
    try {
      const parsed = JSON.parse(editValue)
      const result = await updateMemory(activeTab, parsed)
      if (result.success) {
        setMemory(prev => prev ? { ...prev, [activeTab]: parsed } : prev)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch {
      alert('JSON invalide — vérifie la syntaxe.')
    } finally {
      setSaving(false)
    }
  }, [editValue, activeTab, memory])

  const handleAddNote = useCallback(async () => {
    const note = prompt('Nouvelle note :')
    if (!note?.trim()) return
    const current = memory?.notes ?? []
    const updated = [...current, note.trim()]
    const result = await updateMemory('notes', updated)
    if (result.success) {
      setMemory(prev => prev ? { ...prev, notes: updated } : prev)
      if (activeTab === 'notes') setEditValue(JSON.stringify(updated, null, 2))
    }
  }, [memory, activeTab])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={onClose}
    >
      <div
        className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: 'min(85vh, calc(var(--viewport-h, 100dvh) - 32px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <div>
            <h2 className="font-display text-lg text-theme-ink">🧠 Mémoire d'Arty</h2>
            <p className="text-xs text-theme-muted/70 mt-0.5">Ce qu'Arty sait sur vous — lisible et modifiable</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted"
            aria-label="Fermer"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-theme-border px-3">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-theme-muted hover:text-theme-ink/80'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-theme-muted/70">Chargement…</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-theme-muted">
                  Édite le JSON directement puis sauvegarde.
                </p>
                {activeTab === 'notes' && (
                  <button
                    onClick={handleAddNote}
                    className="text-xs px-2.5 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-medium"
                  >
                    + Ajouter une note
                  </button>
                )}
              </div>

              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 font-mono text-xs bg-theme-ink/[0.03] border border-theme-border rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 min-h-[200px]"
                spellCheck={false}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-theme-border flex items-center justify-between gap-3">
          <p className="text-xs text-theme-muted/70">
            {saved ? '✅ Sauvegardé !' : 'Modifie et sauvegarde pour mettre à jour la mémoire.'}
          </p>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const MemoryViewer = memo(MemoryViewerInner)
