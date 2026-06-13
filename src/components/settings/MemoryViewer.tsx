import { memo, useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { readAllMemory, updateMemory } from '../../services/memoryService'
import type { MemoryData } from '../../services/memoryService'

interface Props {
  onClose: () => void
}

type Tab = 'profil' | 'clients' | 'projets' | 'notes'

const TABS: { key: Tab; icon: string }[] = [
  { key: 'profil', icon: '👤' },
  { key: 'clients', icon: '👥' },
  { key: 'projets', icon: '📁' },
  { key: 'notes', icon: '📝' },
]

function MemoryViewerInner({ onClose }: Props) {
  const { t } = useTranslation()
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
      alert(t('memoryViewer.errors.invalidJson'))
    } finally {
      setSaving(false)
    }
  }, [editValue, activeTab, memory])

  const handleAddNote = useCallback(async () => {
    const note = prompt(t('memoryViewer.promptNote'))
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
            <h2 className="font-display text-lg text-theme-ink">{t('memoryViewer.title')}</h2>
            <p className="text-xs text-theme-muted mt-0.5">{t('memoryViewer.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted"
            aria-label={t('common.close')}
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
                  ? 'border-theme-accent text-theme-accent'
                  : 'border-transparent text-theme-muted hover:text-theme-ink/80'
              }`}
            >
              <span>{tab.icon}</span>
              {t(`memoryViewer.tabs.${tab.key}`)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-theme-muted">{t('common.loading')}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-theme-muted">
                  {t('memoryViewer.editHint')}
                </p>
                {activeTab === 'notes' && (
                  <button
                    onClick={handleAddNote}
                    className="text-xs px-2.5 py-1.5 bg-theme-accent/10 text-theme-accent rounded-lg hover:bg-theme-accent/20 font-medium transition-colors"
                  >
                    {t('memoryViewer.addNote')}
                  </button>
                )}
              </div>

              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 font-mono text-xs bg-theme-ink/[0.03] border border-theme-border rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-theme-accent/40 min-h-[200px]"
                spellCheck={false}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-theme-border flex items-center justify-between gap-3">
          <p className="text-xs text-theme-muted">
            {saved ? t('memoryViewer.savedConfirm') : t('memoryViewer.saveHint')}
          </p>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 bg-theme-accent hover:opacity-90 disabled:opacity-50 text-theme-bg text-sm font-medium rounded-xl transition-opacity"
          >
            {saving ? t('memoryViewer.saving') : t('memoryViewer.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

export const MemoryViewer = memo(MemoryViewerInner)
