/**
 * F-001 — LocalMemoryModal
 * UI CRUD pour la mémoire personnelle locale (100% sur l'appareil).
 *
 * Accessible depuis SettingsModal (bouton « Mémoire locale »).
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getAll,
  addFact,
  updateFact,
  deleteFact,
  clearLocalMemory,
  MAX_FACTS,
  type LocalMemoryFact,
} from '../../services/localMemoryService'

interface Props {
  onClose: () => void
}

export const LocalMemoryModal = memo(function LocalMemoryModal({ onClose }: Props) {
  const { t } = useTranslation()
  const [facts, setFacts] = useState<LocalMemoryFact[]>(() => getAll())
  const [query, setQuery] = useState('')
  const [newContent, setNewContent] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const newInputRef = useRef<HTMLTextAreaElement>(null)

  // Sync avec les mises à jour externes (ex: autre onglet)
  useEffect(() => {
    const handler = (e: Event) => {
      setFacts((e as CustomEvent<LocalMemoryFact[]>).detail)
    }
    window.addEventListener('arty-local-memory-updated', handler)
    return () => window.removeEventListener('arty-local-memory-updated', handler)
  }, [])

  const filtered = query.trim()
    ? facts.filter((f) =>
        f.content.toLowerCase().includes(query.trim().toLowerCase())
      )
    : facts

  const handleAdd = useCallback(() => {
    setAddError(null)
    if (!newContent.trim()) return
    const result = addFact(newContent)
    if (!result) {
      setAddError(t('localMemory.modal.limitReached', { max: MAX_FACTS }))
      return
    }
    setFacts(getAll())
    setNewContent('')
    newInputRef.current?.focus()
  }, [newContent, t])

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Entrée seule = ajouter (Shift+Entrée = saut de ligne)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAdd()
    }
  }

  const startEdit = (fact: LocalMemoryFact) => {
    setEditingId(fact.id)
    setEditContent(fact.content)
    setConfirmDeleteId(null)
  }

  const commitEdit = (id: string) => {
    if (editContent.trim()) {
      updateFact(id, editContent)
      setFacts(getAll())
    }
    setEditingId(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitEdit(id)
    }
    if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      deleteFact(id)
      setFacts(getAll())
      setConfirmDeleteId(null)
    } else {
      setConfirmDeleteId(id)
    }
  }

  const handleClearAll = () => {
    if (window.confirm(t('localMemory.modal.clearAllConfirm'))) {
      clearLocalMemory()
      setFacts([])
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('localMemory.modal.title')}
    >
      <div
        className="bg-theme-bg rounded-sm shadow-xl w-full max-w-md flex flex-col border border-theme-border"
        style={{ maxHeight: 'min(90vh, calc(var(--viewport-h, 100dvh) - 32px))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-theme-border shrink-0">
          <div>
            <h2 className="font-display font-medium text-lg text-theme-ink">
              🧠 {t('localMemory.modal.title')}
            </h2>
            <p className="font-display italic text-xs text-theme-muted mt-0.5">
              {t('localMemory.modal.counter', { count: facts.length, max: MAX_FACTS })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-theme-ink/5 text-theme-ink"
            aria-label={t('localMemory.modal.close')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Privacy notice */}
        <div className="mx-6 mt-4 flex items-start gap-2 bg-theme-surface rounded px-3 py-2 shrink-0">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent mt-0.5 shrink-0">
            <path d="M7 1L1 4V7C1 10.31 3.69 13 7 13C10.31 13 13 10.31 13 7V4L7 1Z"
              stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M7 5V7M7 9H7.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <p className="font-display italic text-[11px] text-theme-muted leading-relaxed">
            {t('localMemory.modal.privacyNotice')}
          </p>
        </div>

        {/* Search */}
        <div className="px-6 mt-4 shrink-0">
          <div className="relative">
            <svg
              width="14" height="14" viewBox="0 0 14 14" fill="none"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted pointer-events-none"
            >
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M9.5 9.5L12.5 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              placeholder={t('localMemory.modal.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-sm bg-theme-surface border border-theme-border rounded text-theme-ink placeholder:text-theme-muted/50 focus:outline-none focus:border-theme-accent"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 mt-3 space-y-1.5 min-h-0">
          {filtered.length === 0 && (
            <p className="font-display italic text-sm text-theme-muted py-6 text-center">
              {query ? t('localMemory.modal.emptySearch') : t('localMemory.modal.empty')}
            </p>
          )}
          {filtered.map((fact) => (
            <div
              key={fact.id}
              className="group flex items-start gap-2 bg-theme-surface rounded px-3 py-2 border border-theme-border"
            >
              {editingId === fact.id ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  onKeyDown={(e) => handleEditKeyDown(e, fact.id)}
                  onBlur={() => commitEdit(fact.id)}
                  autoFocus
                  rows={2}
                  className="flex-1 text-sm bg-transparent text-theme-ink resize-none focus:outline-none"
                  aria-label={t('localMemory.modal.editFieldAria')}
                />
              ) : (
                <button
                  onClick={() => startEdit(fact)}
                  className="flex-1 text-left text-sm text-theme-ink leading-relaxed"
                  aria-label={t('localMemory.modal.editAria', { content: fact.content })}
                >
                  {fact.content}
                </button>
              )}

              {/* Delete button */}
              <button
                onClick={() => handleDelete(fact.id)}
                className="shrink-0 p-1 rounded hover:bg-theme-ink/10 transition-colors"
                aria-label={
                  confirmDeleteId === fact.id
                    ? t('localMemory.modal.confirmDeleteAria')
                    : t('localMemory.modal.deleteAria')
                }
                title={
                  confirmDeleteId === fact.id
                    ? t('localMemory.modal.confirmDeleteAria')
                    : t('localMemory.modal.deleteAria')
                }
              >
                {confirmDeleteId === fact.id ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-red-500">
                    <path d="M2 7L5.5 10.5L12 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-muted group-hover:text-theme-ink transition-colors">
                    <path d="M3 4H11M5 4V2.5A0.5 0.5 0 0 1 5.5 2H8.5A0.5 0.5 0 0 1 9 2.5V4M6 6.5V10M8 6.5V10M3.5 4L4 11.5A0.5 0.5 0 0 0 4.5 12H9.5A0.5 0.5 0 0 0 10 11.5L10.5 4"
                      stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Add new fact */}
        <div className="px-6 pt-3 pb-6 border-t border-theme-border mt-3 shrink-0">
          {addError && (
            <p className="text-xs text-red-500 mb-2" role="alert">{addError}</p>
          )}
          <div className="flex gap-2">
            <textarea
              ref={newInputRef}
              value={newContent}
              onChange={(e) => {
                setNewContent(e.target.value)
                setAddError(null)
              }}
              onKeyDown={handleAddKeyDown}
              placeholder={t('localMemory.modal.addPlaceholder')}
              rows={2}
              disabled={facts.length >= MAX_FACTS}
              className="flex-1 text-sm bg-theme-surface border border-theme-border rounded px-3 py-2 text-theme-ink placeholder:text-theme-muted/50 resize-none focus:outline-none focus:border-theme-accent disabled:opacity-40"
              aria-label={t('localMemory.modal.addPlaceholder')}
            />
            <button
              onClick={handleAdd}
              disabled={!newContent.trim() || facts.length >= MAX_FACTS}
              className="px-3 py-2 bg-theme-accent text-theme-bg text-sm font-medium rounded hover:opacity-90 transition-opacity disabled:opacity-30 shrink-0 self-end"
              aria-label={t('localMemory.modal.addAria')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className="font-display italic text-[10px] text-theme-muted mt-1.5">
            {t('localMemory.modal.addHint')}
          </p>

          {facts.length > 0 && (
            <button
              onClick={handleClearAll}
              className="mt-3 font-display italic text-[11px] text-theme-muted hover:text-red-500 transition-colors"
            >
              {t('localMemory.modal.clearAll')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
