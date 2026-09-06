import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarMiniForm } from '../../components/google/CalendarMiniForm'
import { captureCalendarContext } from '../../services/calendarClient'
import * as calendar from '../../services/calendarClient'
import i18n from '../../i18n'
import { created, google, installCalendarAccount, resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
beforeEach(resetCalendarFixture)
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const detected = { date: new Date(2026, 7, 13, 9), text: '13 août à 9h' }
const props = () => ({ detected, context: 'Synthetic appointment', scope: captureCalendarContext(), onComplete: vi.fn(), onCancel: vi.fn() })
const review = () => fireEvent.click(screen.getByRole('button', { name: 'Vérifier avant envoi' }))
describe('CalendarMiniForm — real transport and crypto', () => {
  it('localizes the complete review and unknown outcome in English', async () => {
    await i18n.changeLanguage('en')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('lost')))
    render(<CalendarMiniForm {...props()} />)
    expect(screen.getByLabelText('Start (Paris)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review before sending' }))
    expect(screen.getByText(/Google account: a@example.invalid/)).toHaveTextContent('Calendar: primary · Europe/Paris')
    expect(screen.getByText(/Confirm this exact action/)).toHaveTextContent('Title')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm creation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Outcome uncertain')
    expect(screen.getByRole('button', { name: 'Confirm creation' })).toBeDisabled()
  })
  it('shows the exact account/Paris/payload before confirmation, then sends once', async () => {
    const fetcher = vi.fn(async () => created()); vi.stubGlobal('fetch', fetcher)
    const p = props(); render(<CalendarMiniForm {...p} />)
    expect(screen.getByLabelText('Début (Paris)')).toHaveValue('2026-08-13T09:00')
    review(); expect(fetcher).not.toHaveBeenCalled()
    expect(screen.getByText(/Compte Google : a@example.invalid/)).toHaveTextContent('2026-08-13T09:00:00+02:00')
    const button = screen.getByRole('button', { name: 'Confirmer la création' })
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(p.onComplete).toHaveBeenCalledOnce())
    expect(fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ type: 'create', calendarAccount: 'a@example.invalid', start: '2026-08-13T09:00:00+02:00', end: '2026-08-13T10:00:00+02:00' })
  })
  it('cancels without a POST', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const p = props(); render(<CalendarMiniForm {...p} />); review()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(p.onCancel).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['same', 'B', 'ABA'])('rejects %s relink after opening without adopting the new account', async transition => {
    const p = props(); render(<CalendarMiniForm {...p} />); review()
    await installCalendarAccount(transition === 'same' ? 'a' : 'b')
    if (transition === 'ABA') await installCalendarAccount('a')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la création' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Action non envoyée')
    expect(fetcher).not.toHaveBeenCalled(); expect(p.onComplete).not.toHaveBeenCalled()
  })
  it('keeps unknown terminal and cannot resend after the response was lost', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('created then lost')); vi.stubGlobal('fetch', fetcher)
    const p = props(); render(<CalendarMiniForm {...p} />); review()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la création' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Issue incertaine')
    expect(screen.getByRole('button', { name: 'Confirmer la création' })).toBeDisabled()
    expect(fetcher).toHaveBeenCalledOnce(); expect(p.onComplete).not.toHaveBeenCalled()
  })
  it('does not publish success if the grant changes after the transport already confirmed', async () => {
    const gate = deferred(), complete = deferred(), original = calendar.prepareCalendarMutation
    vi.spyOn(calendar, 'prepareCalendarMutation').mockImplementation((...args) => {
      const handle = original(...args)
      return { ...handle, async execute(signal) { const result = await handle.execute(signal); complete.resolve(); await gate.promise; return result } }
    })
    vi.stubGlobal('fetch', vi.fn(async () => created()))
    const p = props(); render(<CalendarMiniForm {...p} />); review()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la création' }))
    await complete.promise
    await act(async () => installCalendarAccount('b'))
    await act(async () => gate.resolve())
    expect(p.onComplete).not.toHaveBeenCalled()
  })
  it('unmount during refresh cancels only Calendar, not the shared auth result', async () => {
    await installCalendarAccount('a', true)
    const gate = deferred<Response>(), fetcher = vi.fn(() => gate.promise); vi.stubGlobal('fetch', fetcher)
    const p = props(), { unmount } = render(<CalendarMiniForm {...p} />); review()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la création' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const other = google.getValidAccessToken(); unmount()
    await act(async () => gate.resolve(Response.json({ access_token: 'fresh', expires_in: 3600, oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE })))
    expect(await other).toBe('fresh'); expect(fetcher).toHaveBeenCalledOnce(); expect(p.onComplete).not.toHaveBeenCalled()
  })
})
