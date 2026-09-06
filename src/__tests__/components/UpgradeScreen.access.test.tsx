import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as google from '../../services/googleAuth'
import { initCrypto } from '../../services/crypto'
import { setActiveSession } from '../../services/userSession'
import { setTrialRemaining } from '../../services/trialClient'
import { UpgradeScreen } from '../../screens/upgrade'
import i18n from '../../i18n'
const checkout = vi.hoisted(() => ({ open: vi.fn(), credits: vi.fn() }))
vi.mock('../../services/checkout', () => ({ canPurchase: true, SUBSCRIPTION_PORTAL_URL: 'https://example.invalid/manage',
  openCheckout: checkout.open, openCreemCheckout: checkout.credits }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
let plan = 'vip', auth = 'ok', httpStatus = 200, serial = 0
async function relink(token = 'G2') {
  await google.storeMailboxFreeGrant({ access_token: token, refresh_token: 'SYNTHETIC-REFRESH', expires_at: Date.now() + 3600_000 }, undefined, { verifiedEmail: 'synthetic@example.invalid' })
}
beforeEach(async () => {
  vi.restoreAllMocks(); checkout.open.mockReset(); checkout.credits.mockReset(); localStorage.clear(); google.resetGoogleMemCache()
  setActiveSession({ userId: `offers-${++serial}`, authMethod: 'google', displayName: 'Synthetic', createdAt: 1 })
  await initCrypto(`synthetic-offer-key-${serial}`)
  await google.storeUser({ email: 'synthetic@example.invalid', name: 'Synthetic', picture: '' }); await relink('G1'); await google.bootstrapGoogleStorage()
  await i18n.changeLanguage('fr'); plan = 'vip'; auth = 'ok'; httpStatus = 200
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/wallet/balance') return Response.json({ hasWallet: false, availableMicro: 0, balanceMicro: 0, reservedMicro: 0 })
    if (url !== '/api/subscription/status') throw new Error('Unexpected HTTP')
    expect(new Headers(options?.headers).get('Authorization')).toMatch(/^Bearer G[12]$/)
    expect(new Headers(options?.headers).has('x-google-token')).toBe(false)
    return Response.json({ auth, plan, status: plan === 'free' ? 'inactive' : 'active', has_active_license: plan === 'pro',
      allowed_families: ['claude-haiku'], locked_families: [], daily_remaining: null, daily_limits: null }, { status: httpStatus })
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function mount() { return render(<MemoryRouter><UpgradeScreen currentPlan="unknown" onBack={() => {}} /></MemoryRouter>) }
describe('actual Upgrade + plan hook + Google/crypto, synthetic HTTP (no purchase)', () => {
  it.each([0, 1])('does not sell another plan to usable prepaid credits, but preserves an active trial (%s remaining)', async remaining => {
    plan = 'free'; setTrialRemaining(remaining)
    const normal = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((input, init) => String(input) === '/api/wallet/balance'
      ? Promise.resolve(Response.json({ hasWallet: true, availableMicro: 900000, balanceMicro: 900000, reservedMicro: 0 })) : normal(input, init))
    mount(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(i18n.t('upgrade.statusChecking'))).not.toBeInTheDocument())
    if (remaining === 0) expect(screen.queryByTestId('offer-trial-status')).not.toBeInTheDocument()
    else expect(screen.getByTestId('offer-trial-status')).toHaveTextContent(i18n.t('upgrade.trialRemaining', { count: 1 }))
  })
  it('releases the credit button when another action supersedes its pending balance read', async () => {
    mount(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const normal = vi.mocked(fetch).getMockImplementation()!
    let finish!: (r: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(r => { finish = r }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('upgrade.creditsCta') }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('button', { name: i18n.t('upgrade.creditsBusy') })).toBeDisabled()
    vi.mocked(fetch).mockImplementation(normal)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('upgrade.recheck') }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    await act(async () => { finish(Response.json({ hasWallet: true, availableMicro: 0, balanceMicro: 0, reservedMicro: 0 })) })
    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('upgrade.creditsCta') })).toBeEnabled())
    expect(checkout.credits).not.toHaveBeenCalled()
  })
  it('a focus refresh superseding manual recheck never invents an authentication failure', async () => {
    mount(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    const normal = vi.mocked(fetch).getMockImplementation()!
    let finish!: (r: Response) => void
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(r => { finish = r }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('upgrade.recheck') }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    act(() => window.dispatchEvent(new Event('focus')))
    await act(async () => { finish(await normal('/api/subscription/status', { headers: { Authorization: 'Bearer G1' } })) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    expect(screen.getByTestId('verified-offer-access')).toHaveTextContent('VIP')
    expect(screen.queryByText(i18n.t('upgrade.errorNoToken'))).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('upgrade.statusChecking'))).not.toBeInTheDocument()
  })
  it('checks the real status DTO after checkout without asserting that payment succeeded', async () => {
    mount(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('upgrade.proCta') }))
    await act(async () => { checkout.open.mock.calls[0][2].onReturn() })
    await waitFor(() => expect(screen.getByText(i18n.t('upgrade.statusActive'))).toBeInTheDocument())
    expect(screen.getByTestId('verified-offer-access')).toHaveTextContent('VIP')
    expect(screen.queryByText(/Abonnement activé/)).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('renders Pro as a licence requiring a personal key, with no subscription portal', async () => {
    plan = 'pro'; mount()
    await waitFor(() => expect(screen.getByTestId('verified-offer-access')).toHaveTextContent(/clé API personnelle/))
    expect(screen.queryByRole('link', { name: i18n.t('upgrade.manageSubscription') })).not.toBeInTheDocument()
  })
  it.each(['fr', 'en'])('recognizes VIP without a fictional Pro/subscription licence or a new trial (%s)', async locale => {
    await i18n.changeLanguage(locale); mount()
    await waitFor(() => expect(screen.getByTestId('verified-offer-access')).toHaveTextContent('VIP'))
    expect(screen.queryByText(i18n.t('upgrade.trialCallout'))).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('upgrade.manageSubscription') })).not.toBeInTheDocument()
    expect(checkout.open).not.toHaveBeenCalled(); expect(checkout.credits).not.toHaveBeenCalled()
  })
  it('replaces a known trial counter with ended, never a new trial promise', async () => {
    plan = 'free'; setTrialRemaining(30); mount()
    await waitFor(() => expect(screen.getByTestId('offer-trial-status')).toHaveTextContent('30'))
    act(() => setTrialRemaining(0))
    expect(screen.getByTestId('offer-trial-status')).toHaveTextContent(/terminé/i)
    expect(screen.queryByText(i18n.t('upgrade.trialCallout'))).not.toBeInTheDocument()
  })
  it('does not advertise a new trial when the counter is unknown', async () => {
    plan = 'free'; mount()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('offer-trial-status')).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('upgrade.trialCallout'))).not.toBeInTheDocument()
  })
  it('replaces VIP with reconnect/unavailable and recovers on explicit retry', async () => {
    mount(); await waitFor(() => expect(screen.getByTestId('verified-offer-access')).toHaveTextContent('VIP'))
    auth = 'token_rejected'; act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(screen.queryByTestId('verified-offer-access')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: i18n.t('chat.planBadge.authRequired') })).toBeInTheDocument()
    httpStatus = 503; act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(screen.getByText(i18n.t('chat.planBadge.statusUnavailableTitle'))).toBeInTheDocument())
    auth = 'ok'; httpStatus = 200
    fireEvent.click(screen.getByRole('button', { name: i18n.t('upgrade.recheck') }))
    await waitFor(() => expect(screen.getByTestId('verified-offer-access')).toHaveTextContent('VIP'))
  })
  it('does not accept an old checkout callback after same-account relink', async () => {
    mount(); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('upgrade.proCta') }))
    const callback = checkout.open.mock.calls[0][2].onReturn
    await act(async () => { await relink() })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4))
    await act(async () => { await callback() })
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(screen.queryByText(/Abonnement activé/)).not.toBeInTheDocument()
  })
})
