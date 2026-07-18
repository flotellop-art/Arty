import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState, type ComponentProps } from 'react'
import { Sidebar } from '../../components/layout/Sidebar'
import type { Conversation } from '../../types'

const mocks = vi.hoisted(() => ({
  isPersistent: false,
  setLocale: vi.fn(),
  toggleTheme: vi.fn(() => 'nocturne' as const),
}))

const labels: Record<string, string> = {
  'common.close': 'Fermer la navigation',
  'common.logoutHint': 'Se déconnecter',
  'sidebar.apiKeys': 'Clés API',
  'sidebar.chipImport': 'Importer',
  'sidebar.chipTasks': 'Tâches',
  'sidebar.clearSearch': 'Effacer la recherche',
  'sidebar.deleteAria': 'Supprimer',
  'sidebar.emptyList': 'Aucune conversation',
  'sidebar.home': 'Accueil',
  'sidebar.language': 'Langue',
  'sidebar.logoutAria': 'Se déconnecter',
  'sidebar.navigation': 'Navigation principale',
  'sidebar.newConversation': 'Nouvelle conversation',
  'sidebar.personalProfile': 'Profil personnel',
  'sidebar.recent': 'Récents',
  'sidebar.searchPlaceholder': 'Rechercher une conversation',
  'sidebar.settings': 'Réglages',
  'sidebar.timeAgo.now': 'maintenant',
  'topBar.themeNight': 'Mode nuit',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      labels[key] ?? options?.defaultValue ?? key,
    i18n: { language: 'fr', resolvedLanguage: 'fr' },
  }),
}))

vi.mock('../../i18n', () => ({
  setLocale: mocks.setLocale,
  SUPPORTED_LOCALES: ['fr', 'en'],
}))

vi.mock('../../hooks/useMediaQuery', () => ({
  useMediaQuery: () => mocks.isPersistent,
}))

vi.mock('../../services/themeService', () => ({
  getTheme: () => 'ember',
  toggleTheme: mocks.toggleTheme,
}))

vi.mock('../../services/taskService', () => ({ countPending: () => 0 }))
vi.mock('../../services/conversationExport', () => ({
  importConversationFromFile: vi.fn(),
}))
vi.mock('../../services/toast', () => ({ toast: vi.fn() }))
vi.mock('../../components/settings/SettingsModal', () => ({ SettingsModal: () => null }))
vi.mock('../../components/settings/ApiKeysModal', () => ({ ApiKeysModal: () => null }))
vi.mock('../../components/tasks/TaskPanel', () => ({ TaskPanel: () => null }))
vi.mock('../../components/layout/ConversationTagsModal', () => ({
  ConversationTagsModal: () => null,
}))

const conversation: Conversation = {
  id: 'conversation-active',
  title: 'Conversation active',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

function sidebarProps(overrides: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    conversations: [conversation],
    activeId: conversation.id,
    onSelect: vi.fn(),
    onNew: vi.fn(),
    onDelete: vi.fn(),
    userName: 'Camille',
    ...overrides,
  }
}

describe('Sidebar Fable', () => {
  beforeEach(() => {
    mocks.isPersistent = false
    mocks.setLocale.mockClear()
    mocks.toggleTheme.mockClear()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
  })

  it('rend la navigation principale et déclenche les cibles attendues', () => {
    const onClose = vi.fn()
    const onNew = vi.fn()
    const onHome = vi.fn()
    const onSelect = vi.fn()

    render(<Sidebar {...sidebarProps({ onClose, onNew, onHome, onSelect })} />)

    const navigation = screen.getByRole('navigation', { name: 'Navigation principale' })
    fireEvent.click(within(navigation).getByRole('button', { name: 'Nouvelle conversation' }))
    fireEvent.click(within(navigation).getByRole('button', { name: 'Accueil' }))
    fireEvent.click(screen.getByRole('button', { name: /Conversation active/ }))

    expect(onNew).toHaveBeenCalledTimes(1)
    expect(onHome).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(conversation.id)
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: /Conversation active/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('rend le footer Sol avec ses deux rangées d’actions et le profil', () => {
    const { container } = render(
      <Sidebar {...sidebarProps({ onLogout: vi.fn() })} />,
    )
    const footer = container.querySelector('footer')
    expect(footer).not.toBeNull()
    const footerQueries = within(footer as HTMLElement)

    fireEvent.click(footerQueries.getByRole('button', { name: 'Langue · FR' }))
    fireEvent.click(footerQueries.getByRole('button', { name: 'Mode nuit' }))

    expect(mocks.setLocale).toHaveBeenCalledWith('en')
    expect(mocks.toggleTheme).toHaveBeenCalledTimes(1)
    expect(footerQueries.getByRole('button', { name: 'Clés API' })).toBeInTheDocument()
    expect(footerQueries.getByRole('button', { name: 'Réglages' })).toBeInTheDocument()
    expect(footerQueries.getByText('Camille')).toBeInTheDocument()
    expect(footerQueries.getByText('Profil personnel')).toBeInTheDocument()
    expect(footerQueries.getByRole('button', { name: 'Se déconnecter' })).toBeInTheDocument()
    expect(footer?.querySelectorAll('.grid-cols-2')).toHaveLength(2)
  })

  it('ferme le tiroir mobile avec Échap et restaure le focus au bouton menu', () => {
    function MobileHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button id="arty-menu-button" type="button" onClick={() => setOpen(true)}>
            Ouvrir le menu
          </button>
          <main id="arty-main-shell">Contenu principal</main>
          <Sidebar {...sidebarProps({ isOpen: open, onClose: () => setOpen(false) })} />
        </>
      )
    }

    render(<MobileHarness />)
    const menuButton = screen.getByRole('button', { name: 'Ouvrir le menu' })
    fireEvent.click(menuButton)

    const drawer = screen.getByRole('dialog')
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(within(drawer).getByRole('button', { name: 'Fermer la navigation' })).toHaveFocus()
    expect(screen.getByText('Contenu principal')).toHaveAttribute('aria-hidden', 'true')
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(menuButton).toHaveFocus()
    expect(screen.getByText('Contenu principal')).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('')
  })
})
