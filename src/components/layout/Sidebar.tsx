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
import { Tag, Rule, DotLine } from '../shared/editorial'

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
      <mark
        className="px-0.5 rounded"
        style={{ backgroundColor: 'var(--arty-accent-glow)', color: 'var(--arty-accent)' }}
      >
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  )
}

interface PinnedItem {
  conversationId: string
  conversationTitle: string
  message: Message
}

/** Group conversations by temporal bucket — today / yesterday / earlier. */
function groupByDay(list: Conversation[]) {
  const now = new Date()
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const ysod = sod - 86_400_000
  const today: Conversation[] = []
  const yesterday: Conversation[] = []
  const earlier: Conversation[] = []
  for (const c of list) {
    if (c.updatedAt >= sod) today.push(c)
    else if (c.updatedAt >= ysod) yesterday.push(c)
    else earlier.push(c)
  }
  return { today, yesterday, earlier }
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

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchRaw.trim()), 300)
    return () => clearTimeout(id)
  }, [searchRaw])

  useEffect(() => {
    const refresh = () => setPendingTasks(countPending())
    refresh()
    window.addEventListener('tasks-updated', refresh)
    return () => window.removeEventListener('tasks-updated', refresh)
  }, [])

  const pinned: PinnedItem[] = useMemo(() => {
    const out: PinnedItem[] = []
    for (const conv of conversations) {
      for (const msg of conv.messages) {
        if (msg.pinned) out.push({ conversationId: conv.id, conversationTitle: conv.title, message: msg })
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

  const grouped = useMemo(() => groupByDay(filteredConversations), [filteredConversations])

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

  const ConvRow = ({ c, last }: { c: Conversation; last: boolean }) => {
    const isActive = c.id === activeId
    return (
      <div className="group">
        <div
          className="flex items-start gap-2 px-1 py-2 cursor-pointer"
          style={{
            color: 'var(--arty-ink)',
            backgroundColor: isActive ? 'var(--arty-accent-glow)' : 'transparent',
          }}
        >
          <button
            onClick={() => { onSelect(c.id); onClose() }}
            className="flex-1 text-left min-w-0"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p
                className="font-serif text-[14px] leading-[1.25] truncate"
                style={{ color: isActive ? 'var(--arty-accent)' : 'var(--arty-ink)', fontWeight: 500 }}
              >
                {highlight(c.title, debouncedSearch)}
              </p>
              <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--arty-muted)' }}>
                {timeAgo(c.updatedAt)}
              </span>
            </div>
            {c.messages.length > 0 && (
              <p
                className="text-[12px] mt-0.5 italic font-serif truncate"
                style={{ color: 'var(--arty-muted)' }}
              >
                {(c.messages[c.messages.length - 1]?.content || '').slice(0, 80)}
              </p>
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
            className="opacity-0 group-hover:opacity-100 p-1 transition-all"
            aria-label={t('sidebar.deleteAria')}
            style={{ color: 'var(--arty-muted)' }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4H11L10 12H3L2 4Z M5 4V2H8V4 M1 4H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </button>
        </div>
        {!last && <DotLine />}
      </div>
    )
  }

  const Section = ({ label, items }: { label: string; items: Conversation[] }) => {
    if (items.length === 0) return null
    return (
      <section className="px-5 pt-4">
        <Tag>— {label}</Tag>
        <div className="mt-2">
          {items.map((c, i) => (
            <ConvRow key={c.id} c={c} last={i === items.length - 1} />
          ))}
        </div>
      </section>
    )
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 transition-opacity"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] z-50 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          backgroundColor: 'var(--arty-bg)',
          color: 'var(--arty-ink)',
          borderRight: '1px solid var(--arty-line)',
        }}
      >
        {/* Masthead */}
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <StarIcon size={22} animated />
            <span className="font-display italic text-[22px] tracking-[-0.01em]">arty</span>
          </div>
          <button
            onClick={onClose}
            className="text-[18px] leading-none"
            style={{ color: 'var(--arty-ink)' }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <Rule className="mx-5" />

        {/* Search */}
        <div className="px-5 pt-4">
          <div
            className="relative flex items-center gap-2 px-3 py-2"
            style={{ backgroundColor: 'var(--arty-card)', border: '1px solid var(--arty-line)', borderRadius: 2 }}
          >
            <span style={{ color: 'var(--arty-muted)' }}>⌕</span>
            <input
              type="text"
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder={t('sidebar.search', { defaultValue: 'Rechercher…' })}
              className="flex-1 bg-transparent border-none focus:outline-none text-[13px] font-serif italic"
              style={{ color: 'var(--arty-ink)' }}
            />
            {searchRaw && (
              <button
                onClick={() => setSearchRaw('')}
                className="text-xs"
                style={{ color: 'var(--arty-muted)' }}
                aria-label="Effacer"
              >
                ✕
              </button>
            )}
          </div>
          {debouncedSearch && (
            <p className="text-[10px] mt-1 px-1" style={{ color: 'var(--arty-muted)' }}>
              {filteredConversations.length} résultat{filteredConversations.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* New conversation (full-width ink italic) */}
        <div className="px-5 pt-3">
          <button
            onClick={() => { onNew(); onClose() }}
            className="w-full py-3 font-display italic text-[15px] font-medium flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--arty-ink)', color: 'var(--arty-bg)', borderRadius: 2, letterSpacing: '0.02em' }}
          >
            <span className="not-italic text-[18px] leading-none">+</span>
            {t('sidebar.newConversation')}
          </button>
          {onNewEU && (
            <button
              onClick={() => { onNewEU(); onClose() }}
              className="w-full mt-2 py-2.5 font-serif italic text-[13px]"
              style={{
                backgroundColor: 'var(--arty-accent-glow)',
                color: 'var(--arty-accent)',
                border: `1px solid var(--arty-accent)`,
                borderRadius: 2,
              }}
            >
              🇪🇺 {t('sidebar.newConversationEU')}
            </button>
          )}

          {/* Import + Tasks row */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => importInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px]"
              style={{
                color: 'var(--arty-ink)', backgroundColor: 'var(--arty-card)',
                border: '1px solid var(--arty-line)', borderRadius: 2,
              }}
              title="Importer une conversation JSON"
            >
              <span style={{ color: 'var(--arty-accent)' }}>↥</span>
              <span className="font-serif italic">Importer</span>
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
              className="relative flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px]"
              style={{
                color: 'var(--arty-ink)', backgroundColor: 'var(--arty-card)',
                border: '1px solid var(--arty-line)', borderRadius: 2,
              }}
              title="Tâches"
            >
              <span style={{ color: 'var(--arty-accent)' }}>✓</span>
              <span className="font-serif italic">Tâches</span>
              {pendingTasks > 0 && (
                <span
                  className="absolute -top-1 -right-1 text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
                  style={{ backgroundColor: 'var(--arty-accent)', color: 'var(--arty-bg)' }}
                >
                  {pendingTasks}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Pinned messages */}
        {pinned.length > 0 && !debouncedSearch && (
          <section className="px-5 pt-5">
            <Tag accent>◈ Épinglés ({pinned.length})</Tag>
            <div className="mt-2 max-h-32 overflow-y-auto">
              {pinned.map((p, i) => (
                <button
                  key={p.message.id}
                  onClick={() => { onSelect(p.conversationId); onClose() }}
                  className="w-full text-left py-2 px-1"
                  style={{
                    borderTop: i === 0 ? 'none' : '1px dotted var(--arty-line)',
                  }}
                >
                  <p className="text-[10px] uppercase tracking-wider font-sans truncate" style={{ color: 'var(--arty-muted)' }}>
                    {p.conversationTitle}
                  </p>
                  <p className="font-serif italic text-[12px] mt-0.5 truncate" style={{ color: 'var(--arty-ink)' }}>
                    « {p.message.content.slice(0, 80)} »
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Conversation list */}
        <nav className="flex-1 overflow-y-auto pb-4">
          {filteredConversations.length === 0 && (
            <p className="font-serif italic text-[14px] text-center py-10 px-4" style={{ color: 'var(--arty-muted)' }}>
              {debouncedSearch ? 'Aucun résultat.' : t('sidebar.emptyList')}
            </p>
          )}
          <Section label={t('sidebar.today', { defaultValue: "Aujourd'hui" })} items={grouped.today} />
          <Section label={t('sidebar.yesterday', { defaultValue: 'Hier' })} items={grouped.yesterday} />
          <Section label={t('sidebar.earlier', { defaultValue: 'Plus tôt' })} items={grouped.earlier} />
        </nav>

        <TokenUsageBar />

        <LanguageSelector />

        {/* Settings button editorial */}
        <button
          onClick={() => setShowSettings(true)}
          className="mx-5 mb-2 flex items-center gap-2 px-3 py-2 font-serif italic text-[13px]"
          style={{
            color: 'var(--arty-ink)',
            backgroundColor: 'var(--arty-card)',
            border: '1px solid var(--arty-line)',
            borderRadius: 2,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--arty-accent)' }}>
            <circle cx="7" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 1V2.5M7 11.5V13M13 7H11.5M2.5 7H1M11.24 2.76L10.18 3.82M3.82 10.18L2.76 11.24M11.24 11.24L10.18 10.18M3.82 3.82L2.76 2.76" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Paramètres
        </button>

        {/* User info + logout */}
        {userName && (
          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{ borderTop: '1px solid var(--arty-line)' }}
          >
            <span className="text-xs truncate font-serif italic" style={{ color: 'var(--arty-muted)' }}>
              {userName}
            </span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="text-[10px] uppercase tracking-[0.15em] font-sans font-semibold"
                style={{ color: 'var(--arty-muted)' }}
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
