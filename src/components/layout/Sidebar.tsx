import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, Message } from '../../types'
import { setLocale, SUPPORTED_LOCALES, type Locale } from '../../i18n'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { getTheme, toggleTheme, type Theme } from '../../services/themeService'
import { SettingsModal } from '../settings/SettingsModal'
import { ApiKeysModal } from '../settings/ApiKeysModal'
import { CostIndicator } from './CostIndicator'
import { StreakBadge } from './StreakBadge'
import { homeV2Enabled } from '../../services/homeV2'
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
  onOpen?: () => void
  onClose: () => void
  conversations: Conversation[]
  activeId: string | null
  streamingConvIds?: ReadonlySet<string>
  onSelect: (id: string) => void
  onNew: () => void
  onHome?: () => void
  onNewEU?: () => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  onSetTags?: (id: string, tags: string[]) => void
  userName?: string
  onLogout?: () => void
  onImportConversation?: (id: string) => void
  onOpenTemplates?: () => void
  onOpenCosts?: () => void
  onOpenCompare?: () => void
  onOpenApiKeys?: () => void
}

interface PinnedItem {
  conversationId: string
  conversationTitle: string
  message: Message
}

const NAV_ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-2 border border-transparent px-2.5 py-2 text-left text-[13px] leading-tight text-theme-ink transition-colors hover:border-theme-border focus-visible:border-theme-accent motion-reduce:transition-none min-[900px]:min-h-9'

const UTILITY_BUTTON_CLASS =
  'min-h-11 w-full px-2.5 py-2 text-left text-[12px] leading-tight text-theme-ink transition-colors hover:bg-theme-bg focus-visible:bg-theme-bg motion-reduce:transition-none min-[900px]:min-h-9'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function useTimeAgo() {
  const { t } = useTranslation()
  return (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 60) return t('sidebar.timeAgo.now')
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return t('sidebar.timeAgo.minutes', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('sidebar.timeAgo.hours', { count: hours })
    return t('sidebar.timeAgo.days', { count: Math.floor(hours / 24) })
  }
}

function highlight(text: string, query: string): JSX.Element {
  if (!query) return <>{text}</>
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-theme-accent/15 px-0.5 text-theme-accent-text">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <div
      className="grid h-[35px] w-[35px] shrink-0 place-items-center bg-theme-accent text-xs font-bold text-theme-bg"
      aria-hidden="true"
    >
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  )
}

export const Sidebar = memo(function Sidebar({
  isOpen,
  onOpen,
  onClose,
  conversations,
  activeId,
  streamingConvIds,
  onSelect,
  onNew,
  onHome,
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
  const [showApiKeys, setShowApiKeys] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [searchRaw, setSearchRaw] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pendingTasks, setPendingTasks] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const importInputRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const skipFocusRestoreRef = useRef(false)
  const isPersistent = useMediaQuery('(min-width: 900px)')

  const closeForModal = () => {
    skipFocusRestoreRef.current = !isPersistent
    onClose()
  }

  useEffect(() => {
    if (!confirmDeleteId) return
    const timeout = window.setTimeout(() => setConfirmDeleteId(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [confirmDeleteId])

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(searchRaw.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [searchRaw])

  useEffect(() => {
    const refresh = () => setPendingTasks(countPending())
    refresh()
    window.addEventListener('tasks-updated', refresh)
    return () => window.removeEventListener('tasks-updated', refresh)
  }, [])

  useEffect(() => {
    const refreshTheme = () => setThemeState(getTheme())
    window.addEventListener('theme-changed', refreshTheme)
    return () => window.removeEventListener('theme-changed', refreshTheme)
  }, [])

  useEffect(() => {
    const drawer = drawerRef.current
    if (drawer) drawer.inert = !isOpen && !isPersistent
  }, [isOpen, isPersistent])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (isPersistent || isOpen) searchInputRef.current?.focus()
        else {
          onOpen?.()
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => searchInputRef.current?.focus())
          })
        }
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [isOpen, isPersistent, onOpen])

  // The drawer owns focus and scroll only in its mobile, modal state.
  useEffect(() => {
    const drawer = drawerRef.current
    if (!drawer || !isOpen || isPersistent) return

    const bodyOverflow = document.body.style.overflow
    const htmlOverflow = document.documentElement.style.overflow
    const mainShell = document.getElementById('arty-main-shell')
    const canInertMain = mainShell && !mainShell.contains(drawer)
    const mainWasInert = canInertMain ? mainShell.inert : false
    const mainAriaHidden = canInertMain ? mainShell.getAttribute('aria-hidden') : null

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    if (canInertMain) {
      mainShell.inert = true
      mainShell.setAttribute('aria-hidden', 'true')
    }

    const focusableElements = () =>
      Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
        const style = window.getComputedStyle(element)
        return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden'
      })

    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = focusableElements()
      if (focusable.length === 0) {
        event.preventDefault()
        drawer.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!drawer.contains(active)) {
        event.preventDefault()
        first?.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', handleDrawerKeyDown)
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleDrawerKeyDown)
      document.body.style.overflow = bodyOverflow
      document.documentElement.style.overflow = htmlOverflow
      if (canInertMain) {
        mainShell.inert = mainWasInert
        if (mainAriaHidden === null) mainShell.removeAttribute('aria-hidden')
        else mainShell.setAttribute('aria-hidden', mainAriaHidden)
      }
      const shouldRestoreFocus = !skipFocusRestoreRef.current
      skipFocusRestoreRef.current = false
      if (shouldRestoreFocus) {
        window.requestAnimationFrame(() => document.getElementById('arty-menu-button')?.focus())
      }
    }
  }, [isOpen, isPersistent, onClose])

  const pinned = useMemo<PinnedItem[]>(() => {
    const items: PinnedItem[] = []
    for (const conversation of conversations) {
      for (const message of conversation.messages) {
        if (message.pinned) {
          items.push({
            conversationId: conversation.id,
            conversationTitle: conversation.title,
            message,
          })
        }
      }
    }
    return items
  }, [conversations])

  const { conversations: filteredConversations, snippets } = useMemo(
    () =>
      rankConversations(
        conversations,
        debouncedSearch.toLowerCase(),
        (conversation) =>
          (conversation.tags ?? []).map((tag) => resolveTag(tag, t).label.toLowerCase()),
      ),
    [conversations, debouncedSearch, t],
  )

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename?.(renamingId, renameValue.trim())
    setRenamingId(null)
    setRenameValue('')
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const id = await importConversationFromFile(file)
      onImportConversation?.(id)
      toast(t('sidebar.importSuccess'), 'success')
      onClose()
    } catch (error) {
      toast(error instanceof Error ? error.message : t('sidebar.importFailed'), 'error')
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const rawLocale = (i18n.resolvedLanguage || i18n.language || 'fr').slice(0, 2)
  const activeLocale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale)
    ? (rawLocale as Locale)
    : 'fr'
  const localeIndex = SUPPORTED_LOCALES.indexOf(activeLocale)
  const nextLocale = SUPPORTED_LOCALES[(localeIndex + 1) % SUPPORTED_LOCALES.length] ?? 'fr'
  const cleanName = cleanDisplayName(userName) || t('sidebar.userFallback', { defaultValue: 'Utilisateur' })
  const themeLabel = (
    theme === 'nocturne'
      ? t('topBar.themeDay', { defaultValue: 'Mode jour' })
      : t('topBar.themeNight', { defaultValue: 'Mode nuit' })
  ).replace(/\s*\([^)]*\)\s*$/, '')

  return (
    <>
      {isOpen && !isPersistent && (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default bg-theme-ink/50 motion-reduce:transition-none"
          onClick={onClose}
          aria-label={t('common.close', { defaultValue: 'Fermer la navigation' })}
          tabIndex={-1}
        />
      )}

      <aside
        id="arty-sidebar"
        ref={drawerRef}
        tabIndex={-1}
        role={isOpen && !isPersistent ? 'dialog' : undefined}
        aria-modal={isOpen && !isPersistent ? true : undefined}
        aria-labelledby="arty-sidebar-title"
        aria-hidden={!isOpen && !isPersistent}
        className={`fixed inset-y-0 left-0 z-50 flex h-full w-[88vw] max-w-[320px] flex-col overflow-y-auto border-r border-theme-border bg-theme-surface font-sans text-theme-ink shadow-[12px_0_0_rgb(var(--theme-ink)/0.12)] transition-transform duration-200 ease-out motion-reduce:transition-none min-[900px]:w-[248px] min-[900px]:max-w-none min-[900px]:translate-x-0 min-[900px]:overflow-hidden min-[900px]:shadow-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <header
          className="flex shrink-0 items-center justify-between gap-3 px-3.5 pb-2 pt-4"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
        >
          <div id="arty-sidebar-title" className="text-2xl font-bold tracking-[-0.03em]">
            arty<span className="text-theme-accent">.</span>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center border border-theme-border text-xl text-theme-ink transition-colors hover:border-theme-accent hover:text-theme-accent motion-reduce:transition-none min-[900px]:hidden"
            aria-label={t('common.close', { defaultValue: 'Fermer la navigation' })}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <nav
          className="shrink-0 space-y-0.5 px-3.5"
          aria-label={t('sidebar.navigation', { defaultValue: 'Navigation principale' })}
        >
          <button
            type="button"
            onClick={() => {
              onNew()
              onClose()
            }}
            className="flex min-h-11 w-full items-center gap-2 border border-theme-accent px-2.5 py-2 text-left text-[13px] leading-tight text-theme-accent-text transition-colors hover:bg-theme-accent/5 motion-reduce:transition-none"
          >
            <span className="w-4 text-center" aria-hidden="true">＋</span>
            <span>{t('sidebar.newConversation')}</span>
          </button>

          {onHome && (
            <button
              type="button"
              onClick={() => {
                onHome()
                onClose()
              }}
              className={NAV_ITEM_CLASS}
            >
              <span className="w-4 text-center" aria-hidden="true">⌂</span>
              <span>{t('sidebar.home')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className={NAV_ITEM_CLASS}
            title={t('sidebar.importConversation', { defaultValue: 'Importer une conversation JSON' })}
          >
            <span className="w-4 text-center" aria-hidden="true">↑</span>
            <span>{t('sidebar.chipImport')}</span>
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImport}
            className="hidden"
            tabIndex={-1}
          />

          <button
            type="button"
              onClick={() => {
                setShowTasks(true)
                closeForModal()
            }}
            className={`${NAV_ITEM_CLASS} relative`}
          >
            <span className="w-4 text-center" aria-hidden="true">☰</span>
            <span>{t('sidebar.chipTasks')}</span>
            {pendingTasks > 0 && (
              <span className="ml-auto min-w-5 border border-theme-accent px-1 text-center text-[10px] font-bold text-theme-accent-text">
                {pendingTasks}
              </span>
            )}
          </button>

          {onNewEU && (
            <button
              type="button"
              onClick={() => {
                onNewEU()
                onClose()
              }}
              className={NAV_ITEM_CLASS}
            >
              <span className="w-4 text-center" aria-hidden="true">◇</span>
              <span>
                {t('sidebar.euRegion', {
                  defaultValue: activeLocale === 'fr' ? 'Région UE' : 'EU region',
                })}
              </span>
            </button>
          )}

          {onOpenTemplates && (
            <button
              type="button"
              onClick={() => {
                onOpenTemplates()
                onClose()
              }}
              className={NAV_ITEM_CLASS}
            >
              <span className="w-4 text-center" aria-hidden="true">▤</span>
              <span className="min-w-0 truncate">{t('sidebar.templates')}</span>
              <span className="border border-theme-accent px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-theme-accent-text">
                Pro
              </span>
            </button>
          )}

          {onOpenCosts && (
            <button
              type="button"
              onClick={() => {
                onOpenCosts()
                onClose()
              }}
              className={NAV_ITEM_CLASS}
            >
              <span className="w-4 text-center" aria-hidden="true">◷</span>
              <span>{t('settings.costs.title')}</span>
            </button>
          )}

          {onOpenCompare && (
            <button
              type="button"
              onClick={() => {
                onOpenCompare()
                onClose()
              }}
              className={NAV_ITEM_CLASS}
            >
              <span className="w-4 text-center" aria-hidden="true">⇄</span>
              <span>{t('compare.settingsEntry')}</span>
            </button>
          )}
        </nav>

        <section className="mt-2 px-3.5 pb-2 min-[900px]:min-h-0 min-[900px]:flex-1 min-[900px]:overflow-y-auto">
          {pinned.length > 0 && !debouncedSearch && (
            <div className="mb-3">
              <h2 className="mb-1 px-2.5 text-[10px] font-normal uppercase tracking-[0.14em] text-theme-muted">
                {t('sidebar.pinned', { count: pinned.length })}
              </h2>
              {/* Plafond hérité de l'ancienne sidebar : sans lui, 10 épinglés
                  poussent la liste des conversations hors de l'écran. */}
              <div className="max-h-28 overflow-y-auto">
              {pinned.map((item) => (
                <button
                  key={item.message.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.conversationId)
                    onClose()
                  }}
                  className="w-full border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-theme-border motion-reduce:transition-none"
                >
                  <span className="block truncate text-[12px] text-theme-ink">{item.conversationTitle}</span>
                  <span className="block truncate text-[11px] text-theme-muted">
                    {item.message.content.slice(0, 80)}
                  </span>
                </button>
              ))}
              </div>
            </div>
          )}

          <h2 className="mb-1 px-2.5 text-[10px] font-normal uppercase tracking-[0.14em] text-theme-muted">
            {debouncedSearch
              ? t('sidebar.searchResults', {
                  defaultValue: 'Résultats',
                  count: filteredConversations.length,
                })
              : t('sidebar.recent', { defaultValue: 'Récents' })}
          </h2>

          <div className="relative mb-1">
            <input
              ref={searchInputRef}
              type="search"
              value={searchRaw}
              onChange={(event) => setSearchRaw(event.target.value)}
              placeholder={t('sidebar.searchPlaceholder', { defaultValue: 'Rechercher…' })}
              aria-label={t('sidebar.searchPlaceholder', { defaultValue: 'Rechercher une conversation' })}
              className="h-9 w-full border border-theme-border bg-theme-bg px-2.5 pr-9 text-[12px] text-theme-ink placeholder:text-theme-muted focus:border-theme-accent focus:outline-none"
            />
            {searchRaw && (
              <button
                type="button"
                onClick={() => {
                  setSearchRaw('')
                  searchInputRef.current?.focus()
                }}
                className="absolute inset-y-0 right-0 grid w-9 place-items-center text-xs text-theme-muted transition-colors hover:text-theme-ink motion-reduce:transition-none"
                aria-label={t('sidebar.clearSearch')}
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>

          {filteredConversations.length === 0 && (
            <p className="px-2.5 py-5 text-center text-[12px] text-theme-muted">
              {debouncedSearch ? t('sidebar.noResults') : t('sidebar.emptyList')}
            </p>
          )}

          <div>
            {filteredConversations.map((conversation) => {
              const isActive = conversation.id === activeId
              const isStreaming = streamingConvIds?.has(conversation.id) ?? false
              // Aperçu = dernière réponse d'Arty (plus informatif que la
              // dernière question) ; fallback dernier message. Même logique
              // que l'ancienne sidebar (Roadmap UI Phase 3 #5, cards riches).
              const preview = (() => {
                for (let i = conversation.messages.length - 1; i >= 0; i--) {
                  const m = conversation.messages[i]
                  if (m?.role === 'assistant' && m.content) return m.content
                }
                return conversation.messages[conversation.messages.length - 1]?.content ?? ''
              })()
              const previewClean = preview.replace(/[#*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
              const dominantModel = conversation.usedModels?.[0]
              const conversationDetails = (
                <>
                  <span
                    className={`mt-[6px] h-1.5 w-1.5 shrink-0 border ${
                      isStreaming
                        ? 'animate-pulse border-theme-accent bg-theme-accent motion-reduce:animate-none'
                        : isActive
                          ? 'border-theme-accent bg-theme-accent'
                          : 'border-theme-border bg-transparent'
                    }`}
                    title={isStreaming ? t('sidebar.streamingTitle') : undefined}
                  />
                  <div className="min-w-0 flex-1">
                    {renamingId === conversation.id ? (
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitRename()
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            setRenamingId(null)
                            setRenameValue('')
                          }
                        }}
                        autoFocus
                        aria-label={t('sidebar.renameAria')}
                        className="w-full border-0 border-b border-theme-accent bg-transparent text-[12px] text-theme-ink outline-none"
                      />
                    ) : (
                      <span className="block truncate text-[12px]">
                        {highlight(conversation.title, debouncedSearch)}
                      </span>
                    )}
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-theme-muted">
                      <span className="shrink-0">{timeAgo(conversation.updatedAt)}</span>
                      {conversation.euOnly && (
                        <span
                          className="shrink-0 text-theme-accent"
                          title={t('sidebar.euRegionStatus', {
                            defaultValue: activeLocale === 'fr' ? 'Région UE configurée' : 'EU region configured',
                          })}
                        >
                          ◇
                        </span>
                      )}
                      {conversation.tags?.slice(0, 2).map((tag) => {
                        const resolved = resolveTag(tag, t)
                        return (
                          <span key={tag} className="min-w-0 truncate" title={resolved.label}>
                            <span style={{ color: resolved.color }} aria-hidden="true">●</span>{' '}
                            {resolved.label}
                          </span>
                        )
                      })}
                      {conversation.tags && conversation.tags.length > 2 && (
                        <span className="shrink-0">+{conversation.tags.length - 2}</span>
                      )}
                      {dominantModel && !previewClean && (
                        <span className="shrink-0 uppercase tracking-[0.08em]">{dominantModel}</span>
                      )}
                    </span>
                    {snippets[conversation.id] ? (
                      <span className="mt-0.5 block truncate text-[10px] italic text-theme-muted">
                        {highlight(snippets[conversation.id]!, debouncedSearch)}
                      </span>
                    ) : previewClean && (
                      <span className="mt-0.5 block truncate text-[10px] italic text-theme-muted">
                        {previewClean}
                      </span>
                    )}
                  </div>
                </>
              )
              return (
                <div
                  key={conversation.id}
                  className={`group relative mb-0.5 min-h-11 border transition-colors motion-reduce:transition-none ${
                    isActive
                      ? 'border-theme-accent text-theme-accent-text'
                      : 'border-transparent text-theme-muted hover:border-theme-border hover:text-theme-ink'
                  }`}
                >
                  {renamingId === conversation.id ? (
                    <div className="flex min-w-0 items-start gap-2 px-2.5 py-2 pr-[140px] min-[900px]:pr-0">
                      {conversationDetails}
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => {
                        onSelect(conversation.id)
                        onClose()
                      }}
                      className="flex w-full min-w-0 items-start gap-2 px-2.5 py-2 pr-[140px] text-left min-[900px]:pr-2.5"
                    >
                      {conversationDetails}
                    </button>
                  )}

                  <div className="absolute inset-y-0 right-1 flex items-center bg-theme-surface pl-1 opacity-100 min-[900px]:pointer-events-none min-[900px]:opacity-0 min-[900px]:group-hover:pointer-events-auto min-[900px]:group-hover:opacity-100 min-[900px]:group-focus-within:pointer-events-auto min-[900px]:group-focus-within:opacity-100">
                    {onSetTags && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setEditingTagsId(conversation.id)
                          closeForModal()
                        }}
                        className="grid h-11 w-11 place-items-center text-theme-muted transition-colors hover:bg-theme-bg hover:text-theme-ink motion-reduce:transition-none min-[900px]:h-7 min-[900px]:w-7"
                        aria-label={t('sidebar.tagsAria')}
                        title={t('sidebar.tagsAria')}
                      >
                        <span aria-hidden="true">◇</span>
                      </button>
                    )}
                    {onRename && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setRenamingId(conversation.id)
                          setRenameValue(conversation.title)
                        }}
                        className="grid h-11 w-11 place-items-center text-theme-muted transition-colors hover:bg-theme-bg hover:text-theme-ink motion-reduce:transition-none min-[900px]:h-7 min-[900px]:w-7"
                        aria-label={t('sidebar.renameAria')}
                        title={t('sidebar.renameAria')}
                      >
                        <span aria-hidden="true">✎</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (confirmDeleteId === conversation.id) {
                          setConfirmDeleteId(null)
                          onDelete(conversation.id)
                        } else {
                          setConfirmDeleteId(conversation.id)
                        }
                      }}
                      className={`grid h-11 w-11 place-items-center transition-colors motion-reduce:transition-none min-[900px]:h-7 min-[900px]:w-7 ${
                        confirmDeleteId === conversation.id
                          ? 'bg-red-500/15 text-red-600'
                          : 'text-theme-muted hover:bg-theme-bg hover:text-theme-accent'
                      }`}
                      aria-label={
                        confirmDeleteId === conversation.id
                          ? t('sidebar.confirmDelete')
                          : t('sidebar.deleteAria')
                      }
                      title={
                        confirmDeleteId === conversation.id
                          ? t('sidebar.confirmDelete')
                          : t('sidebar.deleteAria')
                      }
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <footer
          className="mt-auto shrink-0 border-t border-theme-border px-3.5 pt-2"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))' }}
        >
          {/* PR G / revue #353 — coût (live) + série TOUJOURS visibles dans le
              pied (stratégie « limites lisibles ») ; les deux rendent null si
              non pertinents. Gate homeV2 partagé avec TopBar : en rollback
              (arty-home-v2 = '0') c'est le header legacy qui les affiche. */}
          {homeV2Enabled() && (
            <div className="mb-1 flex items-center justify-end gap-1 px-2.5">
              <CostIndicator />
              <StreakBadge />
            </div>
          )}
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setLocale(nextLocale)}
              className={UTILITY_BUTTON_CLASS}
              aria-label={`${t('sidebar.language')} · ${activeLocale.toUpperCase()}`}
              title={`${t('sidebar.language')} · ${activeLocale.toUpperCase()}`}
            >
              {t('sidebar.language')} · {activeLocale.toUpperCase()}
            </button>
            <button
              type="button"
              onClick={() => setThemeState(toggleTheme())}
              className={UTILITY_BUTTON_CLASS}
              aria-label={themeLabel}
              title={themeLabel}
            >
              <span aria-hidden="true">{theme === 'nocturne' ? '☀' : '☾'}</span> {themeLabel}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => {
                if (onOpenApiKeys) onOpenApiKeys()
                else setShowApiKeys(true)
                closeForModal()
              }}
              className={UTILITY_BUTTON_CLASS}
            >
              <span aria-hidden="true">⌘</span> {t('sidebar.apiKeys')}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowSettings(true)
                closeForModal()
              }}
              className={UTILITY_BUTTON_CLASS}
            >
              <span aria-hidden="true">⚙</span> {t('sidebar.settings')}
            </button>
          </div>

          <div className="mt-2 grid grid-cols-[35px_1fr_34px] items-center gap-2 border-t border-theme-border px-2.5 pt-3">
            <Avatar name={cleanName} />
            <div className="min-w-0">
              <strong className="block truncate text-[13px] font-medium text-theme-ink">{cleanName}</strong>
              <span className="mt-0.5 block truncate text-[11px] text-theme-muted">
                {t('sidebar.personalProfile', {
                  defaultValue: activeLocale === 'fr' ? 'Profil personnel' : 'Personal profile',
                })}
              </span>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="grid h-11 w-11 place-items-center text-lg text-theme-ink transition-colors hover:text-theme-accent-text motion-reduce:transition-none min-[900px]:h-[34px] min-[900px]:w-[34px]"
                aria-label={t('sidebar.logoutAria', {
                  defaultValue: activeLocale === 'fr' ? 'Se déconnecter' : 'Log out',
                })}
                title={t('common.logoutHint')}
              >
                <span aria-hidden="true">↪</span>
              </button>
            )}
          </div>
        </footer>
      </aside>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      {!onOpenApiKeys && <ApiKeysModal open={showApiKeys} onClose={() => setShowApiKeys(false)} />}
      {showTasks && <TaskPanel onClose={() => setShowTasks(false)} />}
      {editingTagsId && onSetTags && (() => {
        const conversation = conversations.find((item) => item.id === editingTagsId)
        if (!conversation) return null
        return (
          <ConversationTagsModal
            tags={conversation.tags ?? []}
            onSave={(tags) => {
              onSetTags(editingTagsId, tags)
              setEditingTagsId(null)
            }}
            onClose={() => setEditingTagsId(null)}
          />
        )
      })()}
    </>
  )
})
