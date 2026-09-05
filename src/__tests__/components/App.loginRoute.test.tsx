import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the actual App router and OAuthCallback. Private hooks and screen
// bodies are isolated: this is a routing regression, not an auth/network test.
const fixture = vi.hoisted(() => ({
  authenticated: true,
  login: vi.fn(),
  callback: vi.fn<(_: string) => Promise<void>>(),
  conversation: { conversations: [], streamingConvIds: new Set(), projectReview: { request: null } },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({
  isAuthenticated: fixture.authenticated,
  currentUser: fixture.authenticated ? { userId: 'synthetic', authMethod: 'email' } : null,
  knownSessions: [], login: fixture.login,
}) }))
vi.mock('../../hooks/useConversation', () => ({ useConversation: () => fixture.conversation }))
vi.mock('../../hooks/useAppSetup', () => ({ useAppSetup: () => ({
  googleAuth: { isConnected: false, handleCallback: fixture.callback },
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
vi.mock('../../components/home/HomeScreen', () => ({ HomeScreen: () => <h1>Home screen</h1> }))
vi.mock('../../components/auth/LoginScreen', () => ({ LoginScreen: () => <h1>Login screen</h1> }))
vi.mock('../../components/onboarding/OnboardingChoice', () => ({ isOnboardingChoiceDone: () => true }))
vi.mock('../../components/layout/Sidebar', () => ({ Sidebar: () => <aside>Sidebar</aside> }))
vi.mock('../../components/chat/ConversationScreen', () => ({ ConversationScreen: () => null }))
vi.mock('../../components/chat/ProjectReviewDialog', () => ({ ProjectReviewDialog: () => null }))
vi.mock('../../components/chat/QuestionModal', () => ({ QuestionModal: () => null }))
vi.mock('../../components/home/MorningBrief', () => ({ MorningBrief: () => null }))
vi.mock('../../components/shared/ReportPage', () => ({ ReportPage: () => null }))
vi.mock('../../components/shared/Toaster', () => ({ Toaster: () => null }))
vi.mock('../../components/settings/ApiKeysModal', () => ({ ApiKeysModal: () => null }))
vi.mock('../../components/chat/CapReachedModal', () => ({ CapReachedModal: () => null }))
vi.mock('../../components/auth/GoogleReconnectDialog', () => ({ GoogleReconnectDialog: () => null }))
vi.mock('../../components/share/SharedConversationView', () => ({ SharedConversationView: () => null }))
vi.mock('../../components/onboarding/ProfileSetupModal', () => ({ ProfileSetupModal: () => null }))

import App from '../../App'

beforeEach(() => {
  fixture.authenticated = true
  vi.clearAllMocks()
  fixture.callback.mockResolvedValue(undefined)
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('arty-notif-asked', '1')
  window.history.replaceState({}, '', '/')
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('App login entry routing', () => {
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
