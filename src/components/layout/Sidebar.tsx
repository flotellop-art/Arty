import { memo, useMemo, useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, Message } from '../../types'
import { setLocale, SUPPORTED_LOCALES, type Locale } from '../../i18n'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { CostIndicator } from './CostIndicator'
import { StreakBadge } from './StreakBadge'
import { getTheme, toggleTheme, type Theme } from '../../services/themeService'
import { homeV2Enabled } from '../../services/homeV2'
import { SettingsModal } from '../settings/SettingsModal'
import { ApiKeysModal } from '../settings/ApiKeysModal'
import { TaskPanel } from '../tasks/TaskPanel'
import { countPending } from '../../services/taskService'
import { importConversationFromFile } from '../../services/conversationExport'
import { cleanDisplayName } from '../../services/displayName'
import { toast } from '../../services/toast'
import { resolveTag } from '../../services/conversationTags'
import { rankConversations } from '../../services/conversationSearch'
import { ConversationTagsModal } from './ConversationTagsModal'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  conversations: Conversation[]
  activeId: string | null
  // Convs avec un stream LLM en cours. Affichées avec un dot pulsant pour
  // signaler à l'utilisateur qu'Arty "réfléchit" dans cette conv en arrière-plan.
  streamingConvIds?: ReadonlySet<string>
  onSelect: (id: string) => void
  onNew: () => void
  onNewEU?: () => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  // P1.8 — pose les étiquettes d'une conversation (édition via la modale tags).
  onSetTags?: (id: string, tags: string[]) => void
  userName?: string
  onLogout?: () => void
  onImportConversation?: (id: string) => void
  onOpenTemplates?: () => void
  // PR D — navigation directe : Coûts / Comparateur étaient enfouis dans
  // SettingsModal (2 niveaux + event). Même pattern que onOpenTemplates.
  onOpenCosts?: () => void
  onOpenCompare?: () => void
  // PR D — l'ApiKeysModal remonte au niveau App (un seul propriétaire,
  // ouvrable aussi depuis l'écran Upgrade via 'arty-open-api-keys').
  // La rendre ICI la plaçait dans le containing block du drawer transformé
  // (translate-x) → positionnement fixed cassé si ouverte drawer fermé.
  onOpenApiKeys?: () => void
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

// memo (audit perf H2) — sans ça, la Sidebar (liste complète + previewClean
// recalculés) re-rendait à CHAQUE frame de streaming via AppContent. Les
// props callbacks sont stabilisées côté App/useConversation.
export const Sidebar = memo(function Sidebar({
  isOpen,
  onClose,
  conversations,
  activeId,
  streamingConvIds,
  onSelect,
  onNew,
  onNewEU,
  onDelete,
  onRename,
  onSetTags,
  userName,
  onLogout,
  onImportConversation,
  onOpenTemplates,
  onOpenCosts,
  onOpenCompare,
  onOpenApiKeys,
}: SidebarProps) {
  const { t, i18n } = useTranslation()
  const timeAgo = useTimeAgo()
  const [showSettings, setShowSettings] = useState(false)
  // Fallback local si App ne fournit pas onOpenApiKeys (rétro-compat).
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [searchRaw, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pendingTasks, setPendingTasks] = useState(0)
  // Suppression en 2 temps (audit UX) : 1er tap arme le bouton (rouge), 2e tap
  // supprime. Désarmé après 3 s ou si on arme une autre conv. Évite la
  // suppression irréversible à 1 clic sans introduire de modale.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Renommage inline (audit UX — aucun moyen de renommer une conversation).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // P1.8 — id de la conversation dont on édite les étiquettes (ouvre la modale).
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // PR E — desktop ≥1024px : sidebar persistante (dans le flux, pas overlay).
  // matchMedia (événement discret) → pas de re-render au resize continu.
  const isPersistent = useMediaQuery('(min-width: 1024px)')
  // PR G — coût/série/thème déplacés du header vers le pied (flag partagé
  // avec TopBar pour ne pas dupliquer). État thème local pour l'icône.
  const homeV2 = homeV2Enabled()
  const [theme, setThemeState] = useState<Theme>(getTheme)

  useEffect(() => {
    if (!confirmDeleteId) return
    const id = setTimeout(() => setConfirmDeleteId(null), 3000)
    return () => clearTimeout(id)
  }, [confirmDeleteId])

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRename?.(renamingId, renameValue)
    }
    setRenamingId(null)
    setRenameValue('')
  }

  // A11y : quand le drawer est fermé, `inert` retire tout le sous-arbre du
  // focus clavier ET de l'arbre d'accessibilité (subsume aria-hidden). Réglé
  // via ref car la prop JSX `inert` n'est typée qu'à partir de React 19.
  useEffect(() => {
    const el = drawerRef.current
    // En mode persistant (desktop) la sidebar est toujours visible et
    // interactive → jamais inerte, quel que soit isOpen.
    if (el) el.inert = !isOpen && !isPersistent
  }, [isOpen, isPersistent])

  // ⌘K / Ctrl+K (desktop) → focus la recherche de conversations. Inactif en
  // mobile (pas de persistant) pour ne pas voler le focus sur un clavier
  // matériel branché à un téléphone.
  useEffect(() => {
    if (!isPersistent) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isPersistent])

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

  const { conversations: filteredConversations, snippets } = useMemo(
    () =>
      rankConversations(
        conversations,
        debouncedSearch.toLowerCase(),
        (c) => (c.tags ?? []).map((tag) => resolveTag(tag, t).label.toLowerCase()),
      ),
    [conversations, debouncedSearch, t],
  )

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const id = await importConversationFromFile(file)
      onImportConversation?.(id)
      toast(t('sidebar.importSuccess'), 'success')
      onClose()
    } catch (err) {
      toast(err instanceof Error ? err.message : t('sidebar.importFailed'), 'error')
    }
    if (importInputRef.current) importInputRef.current.value = ''
  }

  const activeLocale = (i18n.resolvedLanguage?.slice(0, 2) || 'fr') as Locale
  const cleanName = cleanDisplayName(userName) || t('sidebar.userFallback', { defaultValue: 'Utilisateur' })

  return (
    <>
      {/* Backdrop — overlay mobile uniquement. En persistant (desktop) la
          sidebar est dans le flux : pas de scrim, sinon couche cliquable. */}
      {isOpen && !isPersistent && (
        <div
          className="fixed inset-0 bg-theme-ink/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer — Design C. lg: la sidebar passe dans le flux (static), pleine
          hauteur, sans ombre/scrim ni cap de largeur. < 1024px : overlay
          strictement identique à avant (garde-fou absolu PR E). */}
      <aside
        ref={drawerRef}
        // Drawer fermé : `inert` (réglé via drawerRef ci-dessus) bloque le Tab
        // focus ET retire du lecteur d'écran. On garde aria-hidden en repli
        // pour les WebViews anciennes sans support `inert`.
        aria-hidden={!isOpen && !isPersistent}
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-theme-surface text-theme-ink z-50 shadow-xl transform transition-transform duration-300 ease-in-out flex flex-col lg:translate-x-0 lg:w-72 lg:max-w-none lg:shadow-none lg:border-r lg:border-theme-border ${
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
            className="p-1.5 rounded-lg text-theme-muted hover:text-theme-ink transition-colors lg:hidden"
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
            {t('sidebar.chipImport')}
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
            {t('sidebar.chipTasks')}
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
              {t('sidebar.chipEU')}
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
              <span className="flex-1 text-left">{t('sidebar.templates')}</span>
              <span
                className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded"
                style={{ background: 'rgb(var(--theme-accent) / 0.15)', color: 'rgb(var(--theme-accent))' }}
              >
                Pro
              </span>
            </button>
          </div>
        )}

        {/* PR D — navigation directe Coûts / Comparateur (étaient enfouis
            sous Paramètres → SettingsModal → event). Même pattern Templates. */}
        {(onOpenCosts || onOpenCompare) && (
          <div className="px-4 pb-3 flex-shrink-0 flex gap-2">
            {onOpenCosts && (
              <button
                onClick={() => {
                  onOpenCosts()
                  onClose()
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[10px] text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-[12.5px] font-medium transition-colors"
                style={{ border: `1px solid ${DESIGN.borderMid}` }}
              >
                <span aria-hidden="true">💸</span>
                <span>{t('settings.costs.title')}</span>
              </button>
            )}
            {onOpenCompare && (
              <button
                onClick={() => {
                  onOpenCompare()
                  onClose()
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-[10px] text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-[12.5px] font-medium transition-colors"
                style={{ border: `1px solid ${DESIGN.borderMid}` }}
              >
                <span aria-hidden="true">⚖️</span>
                <span>{t('compare.settingsEntry')}</span>
              </button>
            )}
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
              ref={searchInputRef}
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder={t('sidebar.searchPlaceholder', { defaultValue: 'Rechercher...' })}
              className="flex-1 bg-transparent border-0 outline-none text-theme-ink text-xs placeholder:text-theme-muted"
            />
            {/* Indice ⌘K — desktop uniquement. */}
            {!searchRaw && isPersistent && (
              <span className="text-[10px] font-mono text-theme-muted select-none">⌘K</span>
            )}
            {searchRaw && (
              <button
                onClick={() => setSearchRaw('')}
                className="text-theme-muted hover:text-theme-ink text-xs"
                aria-label={t('sidebar.clearSearch')}
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
              {t('sidebar.pinned', { count: pinned.length })}
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
              {debouncedSearch ? t('sidebar.noResults') : t('sidebar.emptyList')}
            </div>
          )}
          {filteredConversations.map((conv) => {
            const isActive = conv.id === activeId
            const isStreaming = streamingConvIds?.has(conv.id) ?? false
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
                {/* Dot — top-aligned vs centered for 2-line layout. Si la
                    conv stream en arrière-plan, le dot pulse (orange plein
                    avec animation) pour signaler "Arty réfléchit ici". */}
                <div
                  className={`w-[7px] h-[7px] rounded-full flex-shrink-0 mt-[6px] ${isStreaming ? 'animate-pulse' : ''}`}
                  style={{
                    background: isStreaming || isActive ? 'rgb(var(--theme-accent))' : 'transparent',
                    border: isStreaming || isActive ? 'none' : `1.5px solid ${DESIGN.borderMid}`,
                    boxShadow: isStreaming ? '0 0 8px rgb(var(--theme-accent) / 0.6)' : undefined,
                  }}
                  title={isStreaming ? t('sidebar.streamingTitle') : undefined}
                />
                <div className="flex-1 min-w-0">
                  {/* Ligne 1 — titre (ou input de renommage) + timestamp */}
                  <div className="flex items-baseline justify-between gap-2">
                    {renamingId === conv.id ? (
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                          if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null); setRenameValue('') }
                        }}
                        autoFocus
                        aria-label={t('sidebar.renameAria')}
                        className="flex-1 min-w-0 bg-transparent border-b border-theme-accent text-[13px] text-theme-ink outline-none"
                      />
                    ) : (
                      <span
                        className={`text-[13px] truncate transition-colors ${isActive ? 'text-theme-ink font-medium' : 'text-theme-ink/80'}`}
                      >
                        {highlight(conv.title, debouncedSearch)}
                      </span>
                    )}
                    <span className="text-theme-muted text-[10px] flex-shrink-0">
                      {timeAgo(conv.updatedAt)}
                    </span>
                  </div>
                  {/* Ligne 2 — aperçu + badges contextuels */}
                  {(previewClean || snippets[conv.id] || conv.euOnly || dominantModel || conv.tags?.length) && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {conv.euOnly && (
                        <span className="text-[9px] flex-shrink-0" title={t('sidebar.euTooltip')}>🇪🇺</span>
                      )}
                      {/* P1.8 — chips d'étiquettes (pastille colorée + libellé), max 2
                          affichés pour ne pas charger la ligne ; le reste en « +N ». */}
                      {conv.tags?.slice(0, 2).map((tag) => {
                        const r = resolveTag(tag, t)
                        return (
                          <span
                            key={tag}
                            className="flex items-center gap-0.5 flex-shrink-0 text-[9px] text-theme-muted max-w-[80px]"
                            title={r.label}
                          >
                            <span aria-hidden style={{ color: r.color }}>●</span>
                            <span className="truncate">{r.label}</span>
                          </span>
                        )
                      })}
                      {conv.tags && conv.tags.length > 2 && (
                        <span className="text-[9px] text-theme-muted flex-shrink-0">+{conv.tags.length - 2}</span>
                      )}
                      {snippets[conv.id] ? (
                        <span className="text-[11px] text-theme-muted italic truncate">
                          {highlight(snippets[conv.id]!, debouncedSearch)}
                        </span>
                      ) : previewClean && (
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
                {/* Audit UX — `opacity-0 group-hover` rendait ces actions
                    INVISIBLES sur tactile (pas de hover) : impossible de
                    supprimer une conv sur mobile. Pattern validé ailleurs :
                    50% permanent mobile, hover desktop, focus-visible clavier. */}
                {onSetTags && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingTagsId(conv.id)
                    }}
                    className="opacity-50 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 p-2 rounded hover:bg-theme-ink/5 transition-all text-theme-muted hover:text-theme-ink flex-shrink-0 mt-1"
                    aria-label={t('sidebar.tagsAria')}
                    title={t('sidebar.tagsAria')}
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <path d="M2 2.5h4.5L12 8l-4.5 4.5L2 7V2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      <circle cx="4.5" cy="5" r="0.9" fill="currentColor" />
                    </svg>
                  </button>
                )}
                {onRename && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenamingId(conv.id)
                      setRenameValue(conv.title)
                    }}
                    className="opacity-50 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 p-2 rounded hover:bg-theme-ink/5 transition-all text-theme-muted hover:text-theme-ink flex-shrink-0 mt-1"
                    aria-label={t('sidebar.renameAria')}
                    title={t('sidebar.renameAria')}
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                      <path d="M9.5 2.5L11.5 4.5L5 11H3V9L9.5 2.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmDeleteId === conv.id) {
                      setConfirmDeleteId(null)
                      onDelete(conv.id)
                    } else {
                      setConfirmDeleteId(conv.id)
                    }
                  }}
                  className={`p-2 rounded transition-all flex-shrink-0 mt-1 focus-visible:opacity-100 ${
                    confirmDeleteId === conv.id
                      ? 'opacity-100 bg-red-500/15 text-red-500 hover:bg-red-500/25'
                      : 'opacity-50 md:opacity-0 md:group-hover:opacity-100 hover:bg-theme-accent/10 text-theme-accent'
                  }`}
                  aria-label={confirmDeleteId === conv.id ? t('sidebar.confirmDelete') : t('sidebar.deleteAria')}
                  title={confirmDeleteId === conv.id ? t('sidebar.confirmDelete') : t('sidebar.deleteAria')}
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
          {/* PR G — utilitaires déplacés du header accueil : coût (live) +
              série + bascule thème. Flag partagé avec TopBar (homeV2) pour
              éviter le doublon. CostIndicator/StreakBadge rendent null si
              non pertinents → la rangée reste propre (langue à gauche). */}
          <div className="px-[18px] py-1.5 flex items-center justify-between gap-2">
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
            {homeV2 && (
              <div className="flex items-center gap-1">
                <CostIndicator />
                <StreakBadge />
                <button
                  onClick={() => setThemeState(toggleTheme())}
                  className="p-1.5 rounded-lg hover:bg-theme-ink/5 transition-colors text-theme-ink"
                  aria-label={theme === 'nocturne' ? t('topBar.themeDay') : t('topBar.themeNight')}
                  title={theme === 'nocturne' ? t('topBar.themeDay') : t('topBar.themeNight')}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M10 2.75A7.25 7.25 0 0 1 10 17.25Z" fill="currentColor" />
                  </svg>
                </button>
              </div>
            )}
          </div>

          {/* 2 boutons agrandis : Clés API + Paramètres */}
          <div
            className="px-4 pb-2 pt-2 flex gap-2"
            style={{ borderTop: `1px solid ${DESIGN.borderWeak}` }}
          >
            <button
              onClick={() => (onOpenApiKeys ? onOpenApiKeys() : setShowApiKeys(true))}
              className="flex-1 flex items-center justify-center gap-2 py-2 rounded-[10px] text-theme-muted hover:text-theme-ink hover:bg-theme-ink/5 text-xs font-medium transition-colors"
              style={{ border: `1px solid ${DESIGN.borderMid}` }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 7a4 4 0 11-3.465 6L8 16.535V19H5v-3l6.535-6.535A4 4 0 0115 7z" />
              </svg>
              {t('sidebar.apiKeys')}
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
              {t('sidebar.settings')}
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
                title={t('common.logoutHint')}
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
      {/* Fallback uniquement quand App ne possède pas la modale (onOpenApiKeys
          absent) — sinon double instance (audit PR D, R6). */}
      {!onOpenApiKeys && <ApiKeysModal open={showApiKeys} onClose={() => setShowApiKeys(false)} />}
      {showTasks && <TaskPanel onClose={() => setShowTasks(false)} />}
      {/* P1.8 — modale d'édition des étiquettes de la conversation choisie. */}
      {editingTagsId && onSetTags && (() => {
        const conv = conversations.find((c) => c.id === editingTagsId)
        if (!conv) return null
        return (
          <ConversationTagsModal
            tags={conv.tags ?? []}
            onSave={(tags) => { onSetTags(editingTagsId, tags); setEditingTagsId(null) }}
            onClose={() => setEditingTagsId(null)}
          />
        )
      })()}
    </>
  )
})
