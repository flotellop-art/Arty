import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, Message } from '../../types'
import { ArtyWordmark } from '../shared/PrismMark'
import { TokenUsageBar } from '../shared/TokenUsageBar'
import { LanguageSelector } from '../shared/LanguageSelector'
import { SettingsModal } from '../settings/SettingsModal'
import { TaskPanel } from '../tasks/TaskPanel'
import { countPending } from '../../services/taskService'
import { importConversationFromFile } from '../../services/conversationExport'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onNewEU?: () => void
  onDelete: (id: string) => void
  userName?: string
  onLogout?: () => void
  onImportConversation?: (id: string) => void
}

function useTimeAgo() {
  const { t } = useTranslation()
  return (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return t('sidebar.timeAgo.now')
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return t('sidebar.timeAgo.minutes', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('sidebar.timeAgo.hours', { count: hours })
    const days = Math.floor(hours / 24)
    return t('sidebar.timeAgo.days', { count: days })
  }
}

function highlight(text: string, query: string): JSX.Element {
  if (!query) return <>{text}</>
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const idx = lower.indexOf(q)
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-theme-accent/20 text-theme-accent rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

interface PinnedItem {
  conversationId: string
  conversationTitle: string
  message: Message
}

export function Sidebar({
  isOpen,
  onClose,
  conversations,
  activeId,
  onSelect,
  onNew,
  onNewEU,
  onDelete,
  userName,
  onLogout,
  onImportConversation,
}: SidebarProps) {
  const { t } = useTranslation()
  const timeAgo = useTimeAgo()
  const [showSettings, setShowSettings] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [searchRaw, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pendingTasks, setPendingTasks] = useState(0)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Debounce search (300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchRaw.trim()), 300)
    return () => clearTimeout(t)
  }, [searchRaw])

  // Keep pending tasks badge fresh
  useEffect(() => {
    const refresh = () => setPendingTasks(countPending())
    refresh()
    window.addEventListener('tasks-updated', refresh)
    return () => window.removeEventListener('tasks-updated', refresh)
  }, [])

  // Collect pinned messages across all conversations
  const pinned: PinnedItem[] = useMemo(() => {
    const out: PinnedItem[] = []
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        if (msg.pinned) {
          out.push({ conversationId: conv.id, conversationTitle: conv.title, message: msg })
        }
      }
    }
    return out
  }, [conversations])

  const filteredConversations = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => {
      if (c.title.toLowerCase().includes(q)) return true
      return c.messages.some((m) => m.content.toLowerCase().includes(q))
    })
  }, [conversations, debouncedSearch])

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const id = await importConversationFromFile(file)
      onImportConversation?.(id)
      onClose()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import échoué')
    }
    if (importInputRef.current) importInputRef.current.value = ''
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-theme-ink/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-theme-bg text-theme-ink z-50 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {/* Header — Wordmark + close + double rule (Ember signature) */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <ArtyWordmark size={22} color="rgb(var(--theme-accent))" />
          <button
            onClick={onClose}
            className="text-theme-ink p-1 hover:bg-theme-ink/5 rounded transition-colors"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <div className="mx-5 h-[2px] bg-theme-ink" />
        <div className="mx-5 mt-[3px] h-px bg-theme-ink" />

        {/* New conversation — editorial primary CTA (terracotta outline, Fraunces italic) */}
        <div className="px-4 pt-4">
          <button
            onClick={() => {
              onNew()
              onClose()
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-sm border-2 border-theme-accent bg-transparent text-theme-accent hover:bg-theme-accent hover:text-theme-bg transition-colors font-display italic text-[15px]"
          >
            <span className="text-lg leading-none not-italic">+</span>
            {t('sidebar.newConversation')}
          </button>
          {onNewEU && (
            <button
              onClick={() => {
                onNewEU()
                onClose()
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-sm border border-theme-border bg-transparent hover:bg-theme-ink/5 transition-colors text-xs font-display italic text-theme-ink mt-2"
            >
              <span className="font-mono text-[10px] uppercase tracking-kicker text-theme-accent not-italic">EU</span>
              {t('sidebar.newConversationEU')}
            </button>
          )}
        </div>

        {/* Search — editorial underline (no heavy box) */}
        <div className="px-4 pt-4">
          <div className="relative border-b border-theme-ink">
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-theme-muted">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              type="text"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder={t('sidebar.searchPlaceholder', { defaultValue: 'Rechercher…' })}
              className="w-full pl-6 pr-6 py-2 bg-transparent border-none outline-none text-sm font-display italic text-theme-ink placeholder:text-theme-muted"
            />
            {searchRaw && (
              <button
                onClick={() => setSearchRaw('')}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-theme-muted hover:text-theme-ink text-xs"
                aria-label="Effacer"
              >
                ✕
              </button>
            )}
          </div>
          {debouncedSearch && (
            <p className="font-mono text-[10px] text-theme-muted mt-1">
              {filteredConversations.length} résultat{filteredConversations.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Import + Tasks row — editorial chips */}
        <div className="px-4 pt-3 pb-2 flex gap-2">
          <button
            onClick={() => importInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-theme-border bg-transparent hover:bg-theme-ink/5 text-xs font-display italic text-theme-ink rounded-sm transition-colors"
            title="Importer une conversation JSON"
          >
            <span className="text-theme-accent not-italic">↓</span> Importer
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => setShowTasks(true)}
            className="relative flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 border border-theme-border bg-transparent hover:bg-theme-ink/5 text-xs font-display italic text-theme-ink rounded-sm transition-colors"
            title="Tâches"
          >
            <span className="text-theme-accent not-italic">✓</span> Tâches
            {pendingTasks > 0 && (
              <span className="absolute -top-1 -right-1 bg-theme-accent text-theme-bg text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {pendingTasks}
              </span>
            )}
          </button>
        </div>

        {/* Pinned messages (Feature 3) */}
        {pinned.length > 0 && !debouncedSearch && (
          <div className="px-4 pb-2">
            <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-2">
              — Épinglés ({pinned.length})
            </p>
            <div className="max-h-32 overflow-y-auto">
              {pinned.map((p) => (
                <button
                  key={p.message.id}
                  onClick={() => {
                    onSelect(p.conversationId)
                    onClose()
                  }}
                  className="w-full text-left px-2 py-1.5 hover:bg-theme-ink/5 transition-colors"
                >
                  <p className="font-mono text-[10px] text-theme-muted truncate">
                    {p.conversationTitle}
                  </p>
                  <p className="text-xs text-theme-ink truncate font-display italic">
                    {p.message.content.slice(0, 80)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation list */}
        <nav className="flex-1 overflow-y-auto px-4 pb-4">
          {!debouncedSearch && filteredConversations.length > 0 && (
            <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mt-3 mb-2">
              — {t('sidebar.recent', { defaultValue: 'Conversations' })}
            </p>
          )}
          {filteredConversations.length === 0 && (
            <p className="font-display italic text-sm text-theme-muted text-center py-8">
              {debouncedSearch ? 'Aucun résultat' : t('sidebar.emptyList')}
            </p>
          )}
          {filteredConversations.map((conv, i) => (
            <div
              key={conv.id}
              className={`group flex items-baseline gap-2 py-2.5 cursor-pointer transition-colors border-b border-dotted border-theme-border ${
                i === filteredConversations.length - 1 ? 'border-b-0' : ''
              } ${
                conv.id === activeId ? 'opacity-100' : 'hover:bg-theme-ink/[0.03]'
              }`}
            >
              <button
                onClick={() => {
                  onSelect(conv.id)
                  onClose()
                }}
                className="flex-1 text-left min-w-0"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`font-display text-[15px] truncate leading-tight ${
                    conv.id === activeId ? 'text-theme-accent font-medium' : 'text-theme-ink'
                  }`}>
                    {highlight(conv.title, debouncedSearch)}
                  </p>
                  <p className="font-mono text-[10px] text-theme-muted shrink-0">
                    {timeAgo(conv.updatedAt)}
                  </p>
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(conv.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-theme-accent/10 transition-all text-theme-accent"
                aria-label={t('sidebar.deleteAria')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 4H12L11 13H3L2 4Z" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M5 4V2H9V4" stroke="currentColor" strokeWidth="1.2" />
                  <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </div>
          ))}
        </nav>

        <TokenUsageBar />

        {/* Language selector */}
        <LanguageSelector />

        {/* Settings */}
        <button
          onClick={() => setShowSettings(true)}
          className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-sm text-xs font-display italic text-theme-ink hover:bg-theme-ink/5 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent">
            <circle cx="7" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M7 1V2.5M7 11.5V13M13 7H11.5M2.5 7H1M11.24 2.76L10.18 3.82M3.82 10.18L2.76 11.24M11.24 11.24L10.18 10.18M3.82 3.82L2.76 2.76"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          Paramètres — Clés API
        </button>

        {/* User info + logout */}
        {userName && (
          <div className="px-5 py-3 border-t border-theme-border flex items-center justify-between">
            <span className="font-display italic text-xs text-theme-muted truncate">{userName}</span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="font-sans text-[10px] uppercase tracking-kicker text-theme-muted hover:text-theme-accent transition-colors"
              >
                {t('common.logout')}
              </button>
            )}
          </div>
        )}
      </aside>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      {showTasks && <TaskPanel onClose={() => setShowTasks(false)} />}
    </>
  )
}
