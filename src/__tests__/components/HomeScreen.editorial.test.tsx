import { useEffect, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../../components/home/HomeScreen'
import i18n from '../../i18n'

vi.mock('../../components/layout/TopBar', () => ({
  TopBar: () => <div data-testid="topbar" />,
}))

vi.mock('../../components/layout/InputBar', () => ({
  InputBar: ({ prefill, variant }: { prefill?: { id: number; text: string }; variant?: string }) => (
    <textarea aria-label="composer" data-variant={variant} value={prefill?.text ?? ''} readOnly />
  ),
}))

vi.mock('../../components/home/ProactiveBriefCard', () => ({
  ProactiveBriefCard: ({ onDismiss }: { onDismiss: () => void }) => (
    <section aria-label="Ton brief"><button onClick={onDismiss}>Fermer le brief</button></section>
  ),
}))

vi.mock('../../components/google/GoogleConnectButton', () => ({
  GoogleConnectButton: () => <button>Connecter Google</button>,
}))
vi.mock('../../components/google/GoogleStatus', () => ({ GoogleStatus: () => null }))
vi.mock('../../components/google/CalendarView', () => ({
  CalendarView: ({ onEventsChange }: { onEventsChange?: (events: unknown[], error: string | null) => void }) => {
    useEffect(() => {
      const start = new Date()
      start.setMinutes(start.getMinutes() + 10)
      const end = new Date(start.getTime() + 30 * 60_000)
      onEventsChange?.([{
        id: 'event-1',
        title: 'Revue produit',
        start: start.toISOString(),
        end: end.toISOString(),
      }], null)
    }, [onEventsChange])
    return null
  },
}))
vi.mock('../../components/onboarding/Tooltips', () => ({
  useTooltip: () => ({ TooltipComponent: () => null }),
}))
vi.mock('../../services/publicGoogleOAuthProfile', () => ({
  isPublicGoogleOAuthProfileEnabled: () => false,
}))

const googleAuth = {
  isInitializing: false,
  isConnected: false,
  isLoading: false,
  reconsentRequired: false,
  error: null,
  user: null,
  login: vi.fn(),
  logout: vi.fn(),
}

function renderHome(
  onSend = vi.fn(),
  onDismissBrief = vi.fn(),
  onRestoreBrief = vi.fn(),
  auth = googleAuth,
  briefDismissed = false,
) {
  render(
    <HomeScreen
      onMenuToggle={vi.fn()}
      onSend={onSend}
      isStreaming={false}
      googleAuth={auth as never}
      drive={{} as never}
      userName="Camille"
      proactiveBrief={null}
      briefDismissed={briefDismissed}
      onDismissBrief={onDismissBrief}
      onRestoreBrief={onRestoreBrief}
      conversations={[]}
      onNewConversation={vi.fn()}
    />,
  )
  return { onSend, onDismissBrief, onRestoreBrief }
}

function BriefHarness() {
  const [dismissed, setDismissed] = useState(false)
  return (
    <HomeScreen
      onMenuToggle={vi.fn()}
      onSend={vi.fn()}
      isStreaming={false}
      googleAuth={googleAuth as never}
      drive={{} as never}
      userName="Camille"
      proactiveBrief={null}
      briefDismissed={dismissed}
      onDismissBrief={() => setDismissed(true)}
      onRestoreBrief={() => setDismissed(false)}
      conversations={[]}
      onNewConversation={vi.fn()}
    />
  )
}

describe('HomeScreen — accueil éditorial', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('met le chat au premier plan dans sa variante hero', () => {
    renderHome()

    expect(screen.getByRole('heading', { level: 1, name: /Que voulez-vous accomplir/ })).toBeInTheDocument()
    expect(screen.getByLabelText('composer')).toHaveAttribute('data-variant', 'hero')
    expect(screen.queryByText(/templates métier/)).not.toBeInTheDocument()
  })

  it('affiche une note agenda utile dans la partie haute sans carte', async () => {
    renderHome(vi.fn(), vi.fn(), vi.fn(), { ...googleAuth, isConnected: true })

    expect(await screen.findByText('Revue produit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ouvrir l’agenda du jour' })).toBeInTheDocument()
  })

  it('une action rapide préremplit le composeur sans envoyer', () => {
    const { onSend } = renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'Rédiger' }))

    expect(screen.getByLabelText('composer')).toHaveValue('Aide-moi à rédiger : ')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('une suggestion reste modifiable avant tout envoi', () => {
    const { onSend } = renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'Résumer' }))

    expect(screen.getByLabelText('composer')).toHaveValue('Résume ce contenu : ')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('le brief peut être fermé puis réaffiché avec son état piloté par le hook', () => {
    render(<BriefHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Brief · 0 priorités' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fermer le brief' }))
    expect(screen.queryByLabelText('Ton brief')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Afficher le brief/ }))
    expect(screen.getByLabelText('Ton brief')).toBeInTheDocument()
  })

  it('affiche toujours la restauration après un remount avec brief masqué', () => {
    renderHome(vi.fn(), vi.fn(), vi.fn(), googleAuth, true)

    expect(screen.getByRole('button', { name: /Afficher le brief/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Ton brief')).not.toBeInTheDocument()
  })
})
