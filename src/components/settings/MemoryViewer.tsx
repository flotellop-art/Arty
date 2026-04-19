import { memo, useEffect, useState, useCallback } from 'react'
import { readAllMemory, updateMemory } from '../../services/memoryService'
import type { MemoryData } from '../../services/memoryService'
import { Tag, Rule } from '../shared/editorial'

interface Props {
  onClose: () => void
}

type Tab = 'profil' | 'clients' | 'chantiers' | 'notes'

const TABS: { key: Tab; label: string }[] = [
  { key: 'profil', label: 'Profil' },
  { key: 'clients', label: 'Clients' },
  { key: 'chantiers', label: 'Chantiers' },
  { key: 'notes', label: 'Notes' },
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
          <Tag>Mémoire d'Arty</Tag>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 text-[16px]"
            style={{ color: 'var(--arty-muted)' }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <Rule className="mx-5" />

        {/* Hero */}
        <div className="px-5 pt-3 pb-2">
          <h1 className="font-display text-[24px] leading-[1.05] font-light tracking-[-0.02em]">
            Ce que je <span className="italic" style={{ color: 'var(--arty-accent)' }}>sais de toi</span>.
          </h1>
        </div>

        {/* Tabs rail */}
        <div className="px-5">
          <div className="flex items-center gap-6" style={{ borderBottom: '1px solid var(--arty-line)' }}>
            {TABS.map(tab => {
              const active = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className="relative pb-2 text-[10px] tracking-[0.18em] uppercase font-semibold"
                  style={{ color: active ? 'var(--arty-ink)' : 'var(--arty-muted)' }}
                >
                  {tab.label}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-0 right-0 -bottom-px h-[2px]"
                      style={{ backgroundColor: 'var(--arty-accent)' }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col px-5 pt-3 gap-3">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="font-serif italic text-[14px]" style={{ color: 'var(--arty-muted)' }}>
                Lecture en cours…
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="font-serif italic text-[12px]" style={{ color: 'var(--arty-muted)' }}>
                  Édite le JSON directement puis sauvegarde.
                </p>
                {activeTab === 'notes' && (
                  <button
                    onClick={handleAddNote}
                    className="text-[11px] px-2.5 py-1 font-serif italic"
                    style={{
                      backgroundColor: 'var(--arty-accent-glow)',
                      color: 'var(--arty-accent)',
                      border: '1px solid var(--arty-accent)',
                      borderRadius: 2,
                    }}
                  >
                    + Nouvelle note
                  </button>
                )}
              </div>

              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 font-mono text-xs p-3 resize-none focus:outline-none min-h-[200px]"
                style={{
                  backgroundColor: 'var(--arty-card)',
                  color: 'var(--arty-ink)',
                  border: '1px solid var(--arty-line)',
                  borderRadius: 2,
                }}
                spellCheck={false}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 flex items-center justify-between gap-3"
          style={{ borderTop: '1px solid var(--arty-line)' }}
        >
          <p className="font-serif italic text-[12px]" style={{ color: saved ? 'var(--arty-accent)' : 'var(--arty-muted)' }}>
            {saved ? '✓ Sauvegardé.' : 'Modifie puis sauvegarde.'}
          </p>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 font-serif italic text-[13px] disabled:opacity-50 transition-opacity"
            style={{
              backgroundColor: 'var(--arty-ink)',
              color: 'var(--arty-bg)',
              borderRadius: 2,
            }}
          >
            {saving ? 'Sauvegarde…' : 'Sauvegarder →'}
          </button>
        </div>
      </div>
    </div>
  )
}

export const MemoryViewer = memo(MemoryViewerInner)
