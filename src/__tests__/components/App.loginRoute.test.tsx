import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'

// Exercise the actual App router and OAuthCallback. Private hooks and screen
// bodies are isolated: this is a routing regression, not an auth/network test.
const fixture = vi.hoisted(() => ({
  authenticated: true,
  login: vi.fn(),
  callback: vi.fn<(_: string) => Promise<void>>(),
  accessGate: null as Promise<void> | null,
  conversation: { activeConversation: undefined as Conversation | undefined, error: null as string | null, clearActive: vi.fn(), conversations: [], streamingConvIds: new Set(), projectReview: { request: null }, comparisons: { open: vi.fn(), selection: null, error: null } },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({
  isAuthenticated: fixture.authenticated,
  currentUser: fixture.authenticated ? { userId: 'synthetic', authMethod: 'email' } : null,
  knownSessions: [], login: fixture.login,
}) }))
vi.mock('../../hooks/useConversation', () => ({ useConversation: () => fixture.conversation }))
vi.mock('../../hooks/useProjectSynthesis', () => ({ useProjectSynthesis: () => ({ draft: null, open: vi.fn() }) }))
vi.mock('../../hooks/useClientReply', () => ({ useClientReply: () => ({ draft: null, open: vi.fn() }) }))
vi.mock('../../hooks/useAppSetup', () => ({ useAppSetup: () => ({
  googleAuth: { isConnected: false, handleCallback: fixture.callback },
  setActionScreenshot: vi.fn(),
}) }))
vi.mock('../../hooks/useProactiveBrief', () => ({ useProactiveBrief: () => ({}) }))
vi.mock('../../services/userProfile', () => ({ getUserProfile: () => ({ name: 'Synthetic' }) }))
vi.mock('../../services/costTracker', () => ({ checkBudgetAlert: () => null, formatCost: () => '' }))
vi.mock('../../services/trialClient', () => ({ getTrialRemaining: () => null, getOnboardingSplash: () => null }))
vi.mock('../../services/themeService', () => ({ startThemeWatcher: () => () => {} }))
vi.mock('../../services/proactiveBriefSettings', () => ({ isProactiveBriefEnabled: () => false }))
vi.mock('../../services/morningBriefService', () => ({ shouldShowMorningBrief: () => false }))
vi.mock('../../services/shareTargetService', () => ({
  getPendingShare: async () => null, addShareListener: async () => () => {},
}))
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }))
vi.mock('../../components/home/HomeScreen', () => ({ HomeScreen: ({ connectionsAgenda, onConnections }: { connectionsAgenda?: boolean; onConnections: () => void }) => <><h1>Home screen</h1>{connectionsAgenda && <button onClick={onConnections}>Calendar return</button>}</> }))
vi.mock('../../components/auth/LoginScreen', () => ({ LoginScreen: () => <h1>Login screen</h1> }))
vi.mock('../../components/onboarding/OnboardingChoice', () => ({ isOnboardingChoiceDone: () => true }))
vi.mock('../../components/layout/Sidebar', () => ({ Sidebar: ({ onOpenConnections }: { onOpenConnections: () => void }) => <aside><button onClick={onOpenConnections}>Open connections</button></aside> }))
vi.mock('../../hooks/useConnectionsStatus', () => ({ useConnectionsStatus: () => ({
  state: 'ready', platform: 'android', refresh: vi.fn(), act: (action: () => void) => action(),
  snapshot: { platform: 'android', demo: false, session: 'email', google: 'not-configured', keys: [], mail: 'unknown', mailCount: 0 },
}) }))
vi.mock('../../screens/upgrade', () => ({ UpgradeScreen: ({ onBack }: { onBack: () => void }) => {
  if (fixture.accessGate) throw fixture.accessGate
  return <><h1>Access screen</h1><button onClick={onBack}>Access back</button><button onClick={() => window.dispatchEvent(new Event('arty-open-api-keys'))}>Keys from access</button></>
} }))
vi.mock('../../components/chat/ConversationScreen', () => ({ ConversationScreen: ({ conversation }: { conversation: Conversation }) => <><h1>Chat screen</h1><p>{conversation.messages[0]?.content}</p></> }))
vi.mock('../../components/chat/ProjectReviewDialog', () => ({ ProjectReviewDialog: () => null }))
vi.mock('../../components/chat/QuestionModal', () => ({ QuestionModal: () => null }))
vi.mock('../../components/home/MorningBrief', () => ({ MorningBrief: () => null }))
vi.mock('../../components/shared/ReportPage', () => ({ ReportPage: () => null }))
vi.mock('../../components/shared/Toaster', () => ({ Toaster: () => null }))
vi.mock('../../components/settings/ApiKeysModal', () => ({ ApiKeysModal: ({ open, onClose }: { open: boolean; onClose: () => void }) => open ? <div role="dialog" aria-label="Synthetic keys"><button onClick={onClose}>Close keys</button></div> : null }))
vi.mock('../../components/settings/MailAccountsModal', () => ({ MailAccountsModal: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="Synthetic mail"><button onClick={onClose}>Close mail</button></div> }))
vi.mock('../../components/chat/CapReachedModal', () => ({ CapReachedModal: () => null }))
vi.mock('../../components/auth/GoogleReconnectDialog', () => ({ GoogleReconnectDialog: () => null }))
vi.mock('../../components/share/SharedConversationView', () => ({ SharedConversationView: () => null }))
vi.mock('../../components/onboarding/ProfileSetupModal', () => ({ ProfileSetupModal: () => null }))

import App from '../../App'

beforeEach(() => {
  fixture.authenticated = true
  fixture.accessGate = null
  fixture.conversation.activeConversation = undefined
  fixture.conversation.error = null
  vi.clearAllMocks()
  fixture.callback.mockResolvedValue(undefined)
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('arty-notif-asked', '1')
  window.history.replaceState({}, '', '/')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('App login entry routing', () => {
  it('keeps chat history across real BrowserRouter navigation and disposes the previous screen while access is suspended', async () => {
    const saved: Conversation = { id: 'synthetic-chat', title: 'Synthetic', createdAt: 1, updatedAt: 1,
      messages: [{ id: 'message', role: 'user', timestamp: 1, content: 'History must survive navigation' }] }
    fixture.conversation.activeConversation = saved
    window.history.replaceState({}, '', '/chat/synthetic-chat')
    render(<App />)
    await screen.findByRole('heading', { name: 'Chat screen' })
    fireEvent.click(screen.getByText('Open connections'))
    await screen.findByRole('heading', { name: 'connections.title' })
    expect(screen.queryByText('Chat screen')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('connections.mail.action'))
    expect(screen.getByRole('dialog', { name: 'Synthetic mail' })).toBeInTheDocument()
    expect(screen.getByText('connections.session.action')).toBeDisabled()
    fireEvent.click(screen.getByText('Close mail'))
    let release!: () => void
    fixture.accessGate = new Promise<void>(resolve => { release = resolve })
    fireEvent.click(screen.getByText('connections.session.action'))
    // Regression-sensitive: implicit v7 transitions would retain Connections.
    expect(screen.queryByRole('heading', { name: 'connections.title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { fixture.accessGate = null; release() })
    await screen.findByText('Access screen')
    act(() => window.history.back())
    await screen.findByRole('heading', { name: 'connections.title' })
    act(() => window.history.back())
    await screen.findByRole('heading', { name: 'Chat screen' })
    expect(screen.getByText('History must survive navigation')).toBeInTheDocument()
    expect(fixture.conversation.activeConversation).toBe(saved)
    expect(fixture.conversation.clearActive).not.toHaveBeenCalled()
    expect(fixture.callback).not.toHaveBeenCalled()
  })

  it('keeps Connections, its configurations and fixed access/Agenda returns reachable after a retained subscription error', async () => {
    fixture.conversation.error = 'no_active_subscription'
    vi.stubGlobal('fetch', vi.fn())
    render(<App />)
    await screen.findByText('Access screen')
    fireEvent.click(screen.getByText('Open connections'))
    await screen.findByRole('heading', { name: 'connections.title' })
    expect(window.location.pathname).toBe('/connections')
    fireEvent.click(screen.getByText('connections.keys.action'))
    expect(screen.getByRole('dialog', { name: 'Synthetic keys' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Close keys'))
    fireEvent.click(screen.getByText('connections.mail.action'))
    expect(screen.getByRole('dialog', { name: 'Synthetic mail' })).toBeInTheDocument()
    act(() => window.dispatchEvent(new Event('arty-open-api-keys')))
    expect(screen.queryByRole('dialog', { name: 'Synthetic mail' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByText('Close keys'))
    fireEvent.click(screen.getByText('connections.session.action'))
    await screen.findByText('Access screen')
    expect(window.history.state.usr).toEqual({ fromConnections: true })
    fireEvent.click(screen.getByText('Access back'))
    await screen.findByRole('heading', { name: 'connections.title' })
    expect(window.location.pathname).toBe('/connections')
    fireEvent.click(screen.getByText('connections.google.action'))
    await screen.findByText('Calendar return')
    expect(window.location.pathname).toBe('/')
    expect(window.history.state.usr).toEqual({ connectionsAgenda: true })
    fireEvent.click(screen.getByText('Calendar return'))
    await screen.findByRole('heading', { name: 'connections.title' })
    expect(fixture.conversation.error).toBe('no_active_subscription')
    expect(fetch).not.toHaveBeenCalled(); expect(fixture.callback).not.toHaveBeenCalled()
  })

  it('closes the configuration on route exit without closing a new one opened from access', async () => {
    window.history.replaceState({}, '', '/connections'); render(<App />)
    await screen.findByRole('heading', { name: 'connections.title' })
    fireEvent.click(screen.getByText('connections.mail.action'))
    act(() => { window.history.pushState({}, '', '/upgrade'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await screen.findByText('Access screen')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Keys from access'))
    expect(screen.getByRole('dialog', { name: 'Synthetic keys' })).toBeInTheDocument()
  })

  it.each(['/login', '/login/?next=https%3A%2F%2Fexample.com&code=unused#fragment'])(
    'replaces authenticated %s with home without consuming OAuth state', async path => {
      window.history.replaceState({}, '', path)
      sessionStorage.setItem('arty-oauth-state', 'pending-synthetic-state')
      sessionStorage.setItem('arty-oauth-verifier', 'pending-synthetic-verifier')
      const historyLength = window.history.length
      const push = vi.spyOn(window.history, 'pushState')
      render(<App />)
      expect(await screen.findByRole('heading', { name: 'Home screen' })).toBeInTheDocument()
      expect(window.location.pathname + window.location.search + window.location.hash).toBe('/')
      expect(window.history.length).toBe(historyLength)
      expect(push).not.toHaveBeenCalled()
      expect(fixture.login).not.toHaveBeenCalled()
      expect(fixture.callback).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('arty-oauth-state')).toBe('pending-synthetic-state')
      expect(sessionStorage.getItem('arty-oauth-verifier')).toBe('pending-synthetic-verifier')
    },
  )

  it('keeps the anonymous login screen and redirects only after authentication changes', async () => {
    fixture.authenticated = false
    window.history.replaceState({}, '', '/login')
    const app = render(<App />)
    expect(screen.getByRole('heading', { name: 'Login screen' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
    fixture.authenticated = true
    app.rerender(<App />)
    expect(await screen.findByRole('heading', { name: 'Home screen' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    expect(fixture.login).not.toHaveBeenCalled()
  })

  it('keeps the authenticated callback on its separate route until its handler finishes', async () => {
    let finish!: () => void
    fixture.callback.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    sessionStorage.setItem('arty-oauth-state', 'expected')
    window.history.replaceState({}, '', '/auth/callback?code=synthetic-code&state=expected')
    render(<App />)
    await waitFor(() => expect(fixture.callback).toHaveBeenCalledExactlyOnceWith('synthetic-code'))
    expect(window.location.pathname).toBe('/auth/callback')
    expect(screen.queryByRole('heading', { name: 'Home screen' })).not.toBeInTheDocument()
    expect(sessionStorage.getItem('arty-oauth-state')).toBeNull()
    await act(async () => { finish() })
    expect(await screen.findByRole('heading', { name: 'Home screen' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })

  it('still routes an anonymous callback through the real state rejection', async () => {
    fixture.authenticated = false
    sessionStorage.setItem('arty-oauth-state', 'expected')
    window.history.replaceState({}, '', '/auth/callback?code=synthetic-code&state=forged')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Login screen' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    expect(sessionStorage.getItem('arty-oauth-state')).toBeNull()
    expect(warning).toHaveBeenCalledWith('[OAuthCallback] state mismatch — rejecting callback')
    expect(fixture.login).not.toHaveBeenCalled()
    expect(fixture.callback).not.toHaveBeenCalled()
  })
})
