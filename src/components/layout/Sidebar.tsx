import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, Message } from '../../types'
import { StarIcon } from '../shared/StarIcon'
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
      <mark className="bg-yellow-200 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
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
          className="fixed inset-0 bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-white z-50 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
          <StarIcon size={28} />
          <h2 className="font-serif text-lg font-semibold text-bubble-user">
            Arty
          </h2>
        </div>

        {/* Search */}
        <div className="px-4 pt-3">
          <div className="relative">
            <input
              type="text"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder="Rechercher..."
              className="w-full pl-8 pr-8 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:border-accent bg-gray-50"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
            {searchRaw && (
              <button
                onClick={() => setSearchRaw('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                aria-label="Effacer"
              >
                ✕
              </button>
            )}
          </div>
          {debouncedSearch && (
            <p className="text-[10px] text-gray-400 mt-1 px-1">
              {filteredConversations.length} résultat{filteredConversations.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* New conversation */}
        <div className="px-4 py-3">
          <button
            onClick={() => {
              onNew()
              onClose()
            }}
            className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors text-sm font-medium text-bubble-user"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {t('sidebar.newConversation')}
          </button>
          {onNewEU && (
            <button
              onClick={() => {
                onNewEU()
                onClose()
              }}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-sm font-medium text-blue-700 mt-2"
            >
              <span className="text-base">🇪🇺</span>
              {t('sidebar.newConversationEU')}
            </button>
          )}

          {/* Import + Tasks row */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => importInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs text-gray-600"
              title="Importer une conversation JSON"
            >
              ⬆️ Importer
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
              className="relative flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs text-gray-600"
              title="Tâches"
            >
              ✅ Tâches
              {pendingTasks > 0 && (
                <span className="absolute -top-1 -right-1 bg-accent text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  🔔 {pendingTasks}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Pinned messages (Feature 3) */}
        {pinned.length > 0 && !debouncedSearch && (
          <div className="px-3 pb-2">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 px-2 mb-1">
              📌 Messages épinglés ({pinned.length})
            </p>
            <div className="max-h-32 overflow-y-auto">
              {pinned.map((p) => (
                <button
                  key={p.message.id}
                  onClick={() => {
                    onSelect(p.conversationId)
                    onClose()
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <p className="text-[10px] text-gray-400 truncate">
                    {p.conversationTitle}
                  </p>
                  <p className="text-xs text-bubble-user truncate">
                    {p.message.content.slice(0, 80)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation list */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {filteredConversations.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              {debouncedSearch ? 'Aucun résultat' : t('sidebar.emptyList')}
            </p>
          )}
          {filteredConversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl mb-0.5 cursor-pointer transition-colors ${
                conv.id === activeId
                  ? 'bg-accent/10 text-accent'
                  : 'hover:bg-gray-50 text-bubble-user'
              }`}
            >
              <button
                onClick={() => {
                  onSelect(conv.id)
                  onClose()
                }}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-sm truncate font-normal">
                  {highlight(conv.title, debouncedSearch)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {timeAgo(conv.updatedAt)}
                </p>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(conv.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 transition-all"
                aria-label={t('sidebar.deleteAria')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 4H12L11 13H3L2 4Z" stroke="#EF4444" strokeWidth="1.2" />
                  <path d="M5 4V2H9V4" stroke="#EF4444" strokeWidth="1.2" />
                  <line x1="1" y1="4" x2="13" y2="4" stroke="#EF4444" strokeWidth="1.2" />
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
          className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
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
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-500 truncate">{userName}</span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
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
