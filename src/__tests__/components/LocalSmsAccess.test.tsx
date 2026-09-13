import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
const f = vi.hoisted(() => ({
  available: true, epoch: 1, change: () => {}, invalidate: () => {},
  status: vi.fn(), offer: vi.fn(), open: vi.fn(), request: vi.fn(), revoke: vi.fn(),
}))
vi.mock('../../services/native/localSms', () => ({
  isLocalSmsAvailable: () => f.available, getLocalSmsStatus: f.status,
  offerLocalSmsOnStartup: f.offer, openLocalSmsInbox: f.open,
  requestLocalSmsAccess: f.request, revokeLocalSmsAccess: f.revoke,
  onLocalSmsChanged: (fn: () => void) => { f.change = fn; return () => {} },
}))
vi.mock('../../services/localDataInvalidation', () => ({ onLocalDataInvalidated: (fn: () => void) => { f.invalidate = fn; return () => {} } }))
vi.mock('../../services/userSession', () => ({ getActiveSessionEpoch: () => f.epoch }))
import { LocalSmsAccess, LocalSmsStartup } from '../../components/settings/LocalSmsAccess'
beforeEach(() => {
  vi.clearAllMocks(); f.available = true; f.epoch = 1
  f.status.mockResolvedValue({ decision: 'allowed', permission: true })
  f.offer.mockResolvedValue({ decision: 'declined', permission: false }); f.revoke.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.useRealTimers() })
it('keeps Play and web free of SMS controls', () => {
  f.available = false; render(<LocalSmsAccess />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(f.status).not.toHaveBeenCalled()
})
it('reads metadata only and recovers from a same-account invalidation', async () => {
  render(<LocalSmsAccess />)
  await waitFor(() => expect(screen.getByText(i18n.t('localSms.open'))).toBeEnabled())
  act(() => f.invalidate())
  await waitFor(() => expect(f.status).toHaveBeenCalledTimes(2))
  expect(screen.getByText(i18n.t('localSms.open'))).toBeEnabled(); expect(f.open).not.toHaveBeenCalled()
})
it('withdraws access explicitly and offers reauthorization', async () => {
  render(<LocalSmsAccess />)
  await waitFor(() => expect(screen.getByText(i18n.t('localSms.revoke'))).toBeEnabled())
  f.status.mockResolvedValue({ decision: 'declined', permission: true })
  fireEvent.click(screen.getByText(i18n.t('localSms.revoke')))
  await waitFor(() => expect(screen.getByText(i18n.t('localSms.allow'))).toBeEnabled())
  expect(f.revoke).toHaveBeenCalledOnce(); expect(f.request).not.toHaveBeenCalled()
})
it('waits for onboarding, offers once, and does not loop on consent result events', async () => {
  vi.useFakeTimers()
  const view = render(<LocalSmsStartup ready={false} />)
  await act(() => vi.advanceTimersByTimeAsync(1000)); expect(f.offer).not.toHaveBeenCalled()
  view.rerender(<LocalSmsStartup ready />)
  await act(() => vi.advanceTimersByTimeAsync(500)); expect(f.offer).toHaveBeenCalledOnce()
  act(() => f.change()); await act(() => vi.advanceTimersByTimeAsync(1000))
  expect(f.offer).toHaveBeenCalledOnce()
  f.epoch++; act(() => f.change()); await act(() => vi.advanceTimersByTimeAsync(0))
  expect(f.offer).toHaveBeenCalledTimes(2)
})
