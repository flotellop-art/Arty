import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeScreen } from '../../components/home/HomeScreen'
import i18n from '../../i18n'

vi.mock('../../components/layout/TopBar', () => ({
  TopBar: () => <div data-testid="topbar" />,
}))

vi.mock('../../components/layout/InputBar', () => ({
  InputBar: ({ prefill }: { prefill?: { id: number; text: string } }) => (
    <textarea aria-label="composer" value={prefill?.text ?? ''} readOnly />
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
vi.mock('../../components/google/CalendarView', () => ({ CalendarView: () => null }))
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

function renderHome(onSend = vi.fn(), onDismissBrief = vi.fn(), onRestoreBrief = vi.fn()) {
  render(
    <HomeScreen
      onMenuToggle={vi.fn()}
      onSend={onSend}
      isStreaming={false}
      googleAuth={googleAuth as never}
      drive={{} as never}
      userName="Camille"
      proactiveBrief={null}
      onDismissBrief={onDismissBrief}
      onRestoreBrief={onRestoreBrief}
      conversations={[]}
      onNewConversation={vi.fn()}
    />,
  )
  return { onSend, onDismissBrief, onRestoreBrief }
}

describe('HomeScreen — accueil éditorial', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('une intention préremplit le composeur sans envoyer', () => {
    const { onSend } = renderHome()

    fireEvent.click(screen.getByRole('button', { name: /Préparer/ }))

    expect(screen.getByLabelText('composer')).toHaveValue(
      'Prépare un ordre du jour concis pour ma prochaine réunion. Commence par me demander les informations qui te manquent.',
    )
    expect(onSend).not.toHaveBeenCalled()
  })

  it('une suggestion reste modifiable avant tout envoi', () => {
    const { onSend } = renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'Résumer' }))

    expect(screen.getByLabelText('composer')).toHaveValue('Résume ce contenu : ')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('le brief peut être fermé puis réaffiché', () => {
    const { onDismissBrief, onRestoreBrief } = renderHome()

    fireEvent.click(screen.getByRole('button', { name: 'Fermer le brief' }))
    expect(onDismissBrief).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Ton brief')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Afficher le brief' }))
    expect(onRestoreBrief).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Ton brief')).toBeInTheDocument()
  })
})
