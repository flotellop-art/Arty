import { useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, Message } from '../../types'
import { setLocale, SUPPORTED_LOCALES, type Locale } from '../../i18n'
import { SettingsModal } from '../settings/SettingsModal'
import { ApiKeysModal } from '../settings/ApiKeysModal'
import { TaskPanel } from '../tasks/TaskPanel'
import { countPending } from '../../services/taskService'
import { importConversationFromFile } from '../../services/conversationExport'
import { cleanDisplayName } from '../../services/displayName'

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
  onOpenTemplates?: () => void
}

// Palette du Design C (Claude.ai handoff) — branchée sur les variables
// CSS theme-aware définies dans index.css. En Ember, `card` devient
// cream chaud + bordures encre à faible alpha ; en Nocturne, retour aux
// teintes deep brown / paper-on-dark d'origine.
const DESIGN = {
  card: 'rgb(var(--surface-elev))',
  borderWeak: 'rgb(var(--border-weak))',
  borderMid: 'rgb(var(--border-mid))',
  accentDk: 'rgb(var(--theme-accent))',
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
  onOpenTemplates,
}: SidebarProps) {
  const { t, i18n } = useTranslation()
  const timeAgo = useTimeAgo()
  const [showSettings, setShowSettings] = useState(false)
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [searchRaw, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pendingTasks, setPendingTasks] = useState(0)
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
        // H-UX-3 (audit étape 10) — aria-hidden conditionnel sur drawer fermé.
        // Sans ça, les lecteurs d'écran annoncent les conversations + boutons
        // même quand le drawer est invisible.
        // `inert` attribute serait idéal pour bloquer aussi le Tab focus, mais
        // pas encore typé dans React 18. Migration future : React 19 +
        // @types/react 19 le supporteront proprement.
        aria-hidden={!isOpen}
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

        {/* Templates métier (Pro) */}
        {onOpenTemplates && (
          <div className="px-4 pb-3 flex-shrink-0">
            <button
              onClick={() => {
                onOpenTemplates()
                onClose()
              }}
              className="w-full flex items-center gap-2.5 py-2.5 px-3 rounded-[10px] text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-[12.5px] font-medium transition-colors"
              style={{ border: `1px solid ${DESIGN.borderMid}` }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 10h18M9 4v16" />
              </svg>
              <span className="flex-1 text-left">Templates métier</span>
              <span
                className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded"
                style={{ background: 'rgb(var(--theme-accent) / 0.15)', color: 'rgb(var(--theme-accent))' }}
              >
                Pro
              </span>
            </button>
          </div>
        )}

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
            // Roadmap UI Phase 3 #5 — cards riches.
            // Avant : ligne fine titre + timestamp uniquement.
            // Maintenant : 2 lignes (titre + aperçu) + badges contextuels
            // (EU lock + modèle dominant). Plus rapide à retrouver visuellement
            // une conversation parmi 50+.
            const preview = (() => {
              // Dernier message non-user (réponse Arty) pour l'aperçu — plus
              // informatif que la dernière question utilisateur sur ce qu'a
              // été produit. Fallback sur dernier message si pas de réponse.
              for (let i = conv.messages.length - 1; i >= 0; i--) {
                const m = conv.messages[i]
                if (m?.role === 'assistant' && m.content) return m.content
              }
              return conv.messages[conv.messages.length - 1]?.content ?? ''
            })()
            const previewClean = preview.replace(/[#*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
            const dominantModel = conv.usedModels?.[0]
            return (
              <div
                key={conv.id}
                className="group flex items-start gap-2.5 px-2.5 py-2 rounded-[10px] cursor-pointer transition-colors mb-0.5"
                style={{ background: isActive ? DESIGN.card : 'transparent' }}
                onClick={() => {
                  onSelect(conv.id)
                  onClose()
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(240,226,204,0.05)' }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                {/* Dot — top-aligned vs centered for 2-line layout */}
                <div
                  className="w-[7px] h-[7px] rounded-full flex-shrink-0 mt-[6px]"
                  style={{
                    background: isActive ? 'rgb(var(--theme-accent))' : 'transparent',
                    border: isActive ? 'none' : `1.5px solid ${DESIGN.borderMid}`,
                  }}
                />
                <div className="flex-1 min-w-0">
                  {/* Ligne 1 — titre + timestamp */}
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-[13px] truncate transition-colors ${isActive ? 'text-theme-ink font-medium' : 'text-theme-ink/80'}`}
                    >
                      {highlight(conv.title, debouncedSearch)}
                    </span>
                    <span className="text-theme-muted text-[10px] flex-shrink-0">
                      {timeAgo(conv.updatedAt)}
                    </span>
                  </div>
                  {/* Ligne 2 — aperçu + badges contextuels */}
                  {(previewClean || conv.euOnly || dominantModel) && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {conv.euOnly && (
                        <span className="text-[9px] flex-shrink-0" title="Mode Europe — données restées en France">🇪🇺</span>
                      )}
                      {previewClean && (
                        <span className="text-[11px] text-theme-muted italic truncate">
                          {previewClean}
                        </span>
                      )}
                      {dominantModel && !previewClean && (
                        <span className="text-[9px] uppercase tracking-kicker text-theme-muted/80 flex-shrink-0">
                          {dominantModel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(conv.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-theme-accent/10 transition-all text-theme-accent flex-shrink-0 mt-1"
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
          {/* Langue */}
          <div className="px-[18px] py-1.5 flex items-center justify-start">
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
          </div>

          {/* 2 boutons agrandis : Clés API + Paramètres */}
          <div
            className="px-4 pb-2 pt-2 flex gap-2"
            style={{ borderTop: `1px solid ${DESIGN.borderWeak}` }}
          >
            <button
              onClick={() => setShowApiKeys(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[10px] text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-xs font-medium transition-colors"
              style={{ border: `1px solid ${DESIGN.borderMid}` }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 7a4 4 0 11-3.465 6L8 16.535V19H5v-3l6.535-6.535A4 4 0 0115 7z" />
              </svg>
              Clés API
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[10px] text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-xs font-medium transition-colors"
              style={{ border: `1px solid ${DESIGN.borderMid}` }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1.11-1.56 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 110-4h.09a1.7 1.7 0 001.56-1.11 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34h.01A1.7 1.7 0 0010 3.09V3a2 2 0 114 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87v.01A1.7 1.7 0 0020.91 10H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.56 1.03z" />
              </svg>
              Paramètres
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
      <ApiKeysModal open={showApiKeys} onClose={() => setShowApiKeys(false)} />
      {showTasks && <TaskPanel onClose={() => setShowTasks(false)} />}
    </>
  )
}
