import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, Message } from '../../types'
import { setLocale, SUPPORTED_LOCALES, type Locale } from '../../i18n'
import { SettingsModal } from '../settings/SettingsModal'
import { TaskPanel } from '../tasks/TaskPanel'
import { countPending } from '../../services/taskService'
import { importConversationFromFile } from '../../services/conversationExport'
import { cleanDisplayName } from '../../services/displayName'
import { fetchQuotaStatus, type QuotaStatus } from '../../services/quotaStatus'

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

// Palette issue du Design C (Claude.ai design handoff). Les couleurs
// collent quasi pile avec le theme nocturne (index.css) ; on utilise les
// classes theme quand elles matchent, sinon les hex directes.
const DESIGN = {
  card: '#1C1812',
  borderWeak: 'rgba(240,226,204,0.07)',
  borderMid: 'rgba(240,226,204,0.13)',
  subtle: '#1E1A13',
  accentDk: '#C85A28',
}

const FLAGS: Record<Locale, string> = { fr: '🇫🇷', en: '🇬🇧' }

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

// SVG Prism logo — reproduit depuis le design HTML (pas un import pour
// éviter d'embarquer 64x64 viewBox spécifique au shape du design).
function PrismSVG({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <path d="M32 6 L58 54 L32 40 Z" fill="rgb(var(--theme-accent))" />
      <path d="M32 6 L6 54 L32 40 Z" fill="rgb(var(--theme-accent))" opacity="0.45" />
    </svg>
  )
}

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initial = name[0]?.toUpperCase() ?? '?'
  return (
    <div
      className="flex items-center justify-center flex-shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${DESIGN.accentDk}, rgb(var(--theme-accent)))`,
      }}
    >
      <span style={{ color: '#1A0E08', fontSize: size * 0.42, fontWeight: 700 }}>{initial}</span>
    </div>
  )
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
  const { t, i18n } = useTranslation()
  const timeAgo = useTimeAgo()
  const [showSettings, setShowSettings] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [searchRaw, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pendingTasks, setPendingTasks] = useState(0)
  const [statsOpen, setStatsOpen] = useState(false)
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Debounce search (300ms)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchRaw.trim()), 300)
    return () => clearTimeout(id)
  }, [searchRaw])

  // Badge tâches
  useEffect(() => {
    const refresh = () => setPendingTasks(countPending())
    refresh()
    window.addEventListener('tasks-updated', refresh)
    return () => window.removeEventListener('tasks-updated', refresh)
  }, [])

  // Fetch quota au 1er open, rafraîchi quand statsOpen toggle.
  // Pas de polling — l'utilisateur doit rouvrir ou toggler pour rafraîchir.
  useEffect(() => {
    if (!isOpen) return
    fetchQuotaStatus().then(setQuota).catch(() => setQuota(null))
  }, [isOpen, statsOpen])

  // Pinned messages across all conversations
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

  const activeLocale = (i18n.resolvedLanguage?.slice(0, 2) || 'fr') as Locale
  const cleanName = cleanDisplayName(userName) || t('sidebar.userFallback', { defaultValue: 'Utilisateur' })

  // Stats footer : utilise les vrais totaux serveur (tokens réels capturés
  // dans les streams par les proxies). Si le quota n'est pas encore chargé
  // (ou user non whitelisté), on affiche "—".
  const tokenLabel = quota ? `$${quota.totalCostUsd.toFixed(3)}` : '—'
  const totalInput = quota?.byModel.reduce((s, m) => s + m.inputTokens + m.cacheReadTokens + m.cacheCreationTokens, 0) ?? 0
  const totalOutput = quota?.byModel.reduce((s, m) => s + m.outputTokens, 0) ?? 0
  const totalRequests = quota?.total ?? 0

  const formatK = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
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

      {/* Drawer — Design C */}
      <aside
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-theme-surface text-theme-ink z-50 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
      >
        {/* Header — logo + close */}
        <div
          className="px-5 pt-4 pb-4 flex items-center justify-between flex-shrink-0"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
        >
          <div className="flex items-center gap-2">
            <PrismSVG size={16} />
            <span className="text-theme-ink text-[17px] font-medium tracking-[0.01em]">arty</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-theme-muted hover:text-theme-ink transition-colors"
            aria-label={t('common.close')}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* CTA — gros bouton gradient orange */}
        <div className="px-4 pb-4 flex-shrink-0">
          <button
            onClick={() => {
              onNew()
              onClose()
            }}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-[14px] border-0 cursor-pointer text-[13.5px] font-bold tracking-[0.01em] transition-transform hover:-translate-y-[1px]"
            style={{
              background: `linear-gradient(150deg, ${DESIGN.accentDk} 0%, rgb(var(--theme-accent)) 100%)`,
              color: '#1C0E06',
              boxShadow: '0 6px 24px rgba(245,154,75,0.22), 0 1px 0 rgba(255,255,255,0.12) inset',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#1C0E06" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('sidebar.newConversation')}
          </button>
        </div>

        {/* 3 chips : Importer / Tâches / EU */}
        <div className="px-4 pb-4 flex gap-[7px] flex-shrink-0">
          <button
            onClick={() => importInputRef.current?.click()}
            className="flex-1 flex flex-col items-center gap-[5px] py-2 px-1 rounded-[10px] bg-transparent text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-[11px] font-medium transition-colors"
            style={{ border: `1px solid ${DESIGN.borderMid}` }}
            title={t('sidebar.importConversation', { defaultValue: 'Importer une conversation JSON' })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15l-3.5-3.5h2.5V4h2v7.5H15zM4 17h16" />
            </svg>
            Importer
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
            className="relative flex-1 flex flex-col items-center gap-[5px] py-2 px-1 rounded-[10px] bg-transparent text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-[11px] font-medium transition-colors"
            style={{ border: `1px solid ${DESIGN.borderMid}` }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
            Tâches
            {pendingTasks > 0 && (
              <span className="absolute top-1 right-1 bg-theme-accent text-theme-bg text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-1">
                {pendingTasks}
              </span>
            )}
          </button>
          {onNewEU && (
            <button
              onClick={() => {
                onNewEU()
                onClose()
              }}
              className="flex-1 flex flex-col items-center gap-[5px] py-2 px-1 rounded-[10px] bg-transparent text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-[11px] font-medium transition-colors"
              style={{ border: `1px solid ${DESIGN.borderMid}` }}
              title={t('sidebar.newConversationEU')}
            >
              <span className="text-sm leading-none">🇪🇺</span>
              EU sécurisé
            </button>
          )}
        </div>

        {/* Search */}
        <div className="px-4 pb-3 flex-shrink-0">
          <div
            className="flex items-center gap-2 rounded-[10px] px-3 py-2"
            style={{ background: DESIGN.card, border: `1px solid ${DESIGN.borderWeak}` }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="text-theme-muted">
              <path d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder={t('sidebar.searchPlaceholder', { defaultValue: 'Rechercher...' })}
              className="flex-1 bg-transparent border-0 outline-none text-theme-ink text-xs placeholder:text-theme-muted"
            />
            {searchRaw && (
              <button
                onClick={() => setSearchRaw('')}
                className="text-theme-muted hover:text-theme-ink text-xs"
                aria-label="Effacer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Pinned messages (préservé) */}
        {pinned.length > 0 && !debouncedSearch && (
          <div className="px-4 pb-2 flex-shrink-0">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-theme-muted mb-1.5 px-2">
              Épinglés ({pinned.length})
            </p>
            <div className="max-h-24 overflow-y-auto">
              {pinned.map((p) => (
                <button
                  key={p.message.id}
                  onClick={() => {
                    onSelect(p.conversationId)
                    onClose()
                  }}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-theme-ink/5 transition-colors"
                >
                  <p className="text-[10px] text-theme-muted truncate">{p.conversationTitle}</p>
                  <p className="text-xs text-theme-ink truncate">{p.message.content.slice(0, 80)}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto px-2">
          <div className="px-2 pb-2 pt-0.5">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-theme-muted">
              {debouncedSearch ? t('sidebar.searchResults', { defaultValue: 'Résultats', count: filteredConversations.length }) : t('sidebar.recent', { defaultValue: 'Récent' })}
            </span>
          </div>
          {filteredConversations.length === 0 && (
            <div className="px-3 py-5 text-center text-theme-muted text-xs">
              {debouncedSearch ? 'Aucun résultat' : t('sidebar.emptyList')}
            </div>
          )}
          {filteredConversations.map((conv) => {
            const isActive = conv.id === activeId
            return (
              <div
                key={conv.id}
                className="group flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] cursor-pointer transition-colors mb-0.5"
                style={{ background: isActive ? DESIGN.card : 'transparent' }}
                onClick={() => {
                  onSelect(conv.id)
                  onClose()
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(240,226,204,0.05)' }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                {/* Dot */}
                <div
                  className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                  style={{
                    background: isActive ? 'rgb(var(--theme-accent))' : 'transparent',
                    border: isActive ? 'none' : `1.5px solid ${DESIGN.borderMid}`,
                  }}
                />
                <span
                  className={`text-[13px] flex-1 truncate transition-colors ${isActive ? 'text-theme-ink font-medium' : 'text-theme-ink/60'}`}
                >
                  {highlight(conv.title, debouncedSearch)}
                </span>
                <span className="text-theme-muted text-[10px] flex-shrink-0">
                  {timeAgo(conv.updatedAt)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(conv.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-theme-accent/10 transition-all text-theme-accent flex-shrink-0"
                  aria-label={t('sidebar.deleteAria')}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M2 4H12L11 13H3L2 4Z" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M5 4V2H9V4" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0" style={{ borderTop: `1px solid ${DESIGN.borderWeak}` }}>
          {/* Stats toggle — "Tokens ce mois — $X.XX" */}
          <button
            onClick={() => setStatsOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-[18px] py-2.5 bg-transparent hover:bg-theme-ink/[0.04] transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="text-theme-muted">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span className="text-theme-muted text-[11px] flex-1 text-left">
              {t('sidebar.tokensThisMonth', { defaultValue: 'Tokens ce jour' })} — <span className="text-theme-accent font-semibold">{tokenLabel}</span>
            </span>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              className="text-theme-muted flex-shrink-0 transition-transform"
              style={{ transform: statsOpen ? 'rotate(180deg)' : 'rotate(0)' }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {/* Stats expanded : Requêtes / Input / Output */}
          {statsOpen && (
            <div
              className="px-[14px] pb-2.5 grid gap-1.5"
              style={{ gridTemplateColumns: '1fr 1fr 1fr', animation: 'fadeIn 0.18s ease' }}
            >
              {[
                ['Requêtes', String(totalRequests)],
                ['Input', formatK(totalInput)],
                ['Output', formatK(totalOutput)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg px-2.5 py-2"
                  style={{ background: DESIGN.card, border: `1px solid ${DESIGN.borderWeak}` }}
                >
                  <div className="text-theme-muted text-[9px] mb-0.5 tracking-[0.06em] uppercase">{label}</div>
                  <div className="text-theme-ink text-[13px] font-semibold">{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Langue + Clés API */}
          <div className="px-[18px] py-1.5 flex items-center justify-between">
            <div className="flex gap-1.5 items-center">
              {SUPPORTED_LOCALES.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setLocale(loc)}
                  className={`text-sm transition-opacity ${activeLocale === loc ? 'opacity-100' : 'opacity-35 hover:opacity-70'}`}
                  aria-label={loc.toUpperCase()}
                  aria-pressed={activeLocale === loc}
                >
                  {FLAGS[loc]}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="text-theme-muted hover:text-theme-ink text-[11px] px-1.5 py-1 rounded-md flex items-center gap-1.5 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 110 20A10 10 0 0112 2zM12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20M2 12h20" />
              </svg>
              Clés API
            </button>
          </div>

          {/* User row */}
          <div
            className="px-4 pt-2 pb-4 flex items-center gap-2.5"
            style={{
              borderTop: `1px solid ${DESIGN.borderWeak}`,
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))',
            }}
          >
            <Avatar name={cleanName} size={28} />
            <span className="text-theme-ink text-xs font-medium flex-1 truncate">{cleanName}</span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="bg-transparent text-theme-muted hover:text-theme-ink text-[10px] px-2.5 py-1 rounded-md transition-colors"
                style={{ border: `1px solid ${DESIGN.borderMid}` }}
              >
                {t('common.logout')}
              </button>
            )}
          </div>
        </div>
      </aside>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      {showTasks && <TaskPanel onClose={() => setShowTasks(false)} />}
    </>
  )
}
