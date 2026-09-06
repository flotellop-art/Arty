import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarView } from '../../components/google/CalendarView'
import { deferred } from '../helpers/workspaceLocks'
import { relinkCalendarGoogle, resetCalendarFixture, syntheticEvent } from '../helpers/calendarFixture'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
let events = [syntheticEvent]
let fetcher: ReturnType<typeof vi.fn>
beforeEach(async () => {
  await resetCalendarFixture(); events = [syntheticEvent]
  fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string)
    if (body.type === 'list') return Response.json({ events })
    if (body.type === 'update') { events = [{ ...syntheticEvent, title: body.title }]; return Response.json({ success: true, title: body.title }) }
    if (body.type === 'delete') { events = []; return Response.json({ success: true }) }
    throw new Error('Unexpected request')
  }); vi.stubGlobal('fetch', fetcher)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const writes = () => fetcher.mock.calls.filter(([, init]) => JSON.parse(init.body).type !== 'list')
async function openDelete() { fireEvent.click(await screen.findByRole('button', { name: /Supprimer Synthetic/i })) }
const confirmDelete = () => fireEvent.click(screen.getByRole('button', { name: 'Placer dans la corbeille' }))

describe('CalendarView — real UI → owned transport → synthetic HTTP', () => {
  it('renders sibling accessible controls without nested buttons', async () => {
    const { container } = render(<CalendarView onEventClick={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /Ouvrir .* Google Agenda/i })).toBeInTheDocument()
    expect(container.querySelector('button button')).toBeNull()
  })
  it('confirms the exact account/title/ID then changes only the title and reloads', async () => {
    render(<CalendarView />)
    fireEvent.click(await screen.findByRole('button', { name: /Modifier Synthetic/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /Titre de l’événement/i }), { target: { value: '  Changed  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Événement modifié')
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('a@example.invalid'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('opaque-google-id'))
    expect(JSON.parse(writes()[0][1].body)).toEqual({ calendarProtocol: 1, calendarAccount: 'a@example.invalid', type: 'update', eventId: 'opaque-google-id', title: 'Changed' })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  })
  it.each(['Annuler', 'Escape'])('cancels deletion with %s, zero writes and restored focus', async action => {
    render(<CalendarView />); await openDelete()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('a@example.invalid'); expect(dialog).toHaveTextContent('Synthetic appointment')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Annuler' })).toHaveFocus())
    if (action === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' })
    else fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(writes()).toHaveLength(0)
    await waitFor(() => expect(screen.getByRole('button', { name: /Supprimer Synthetic/i })).toHaveFocus())
  })
  it('deletes the exact ID, focuses success and removes the displayed row', async () => {
    render(<CalendarView />); await openDelete(); confirmDelete()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Événement supprimé')
    await waitFor(() => expect(status).toHaveFocus())
    expect(JSON.parse(writes()[0][1].body).eventId).toBe('opaque-google-id')
    expect(screen.queryByText(syntheticEvent.title)).not.toBeInTheDocument()
  })
  it.each(['refused', 'unknown'])('one attempt on double click and an honest %s message', async kind => {
    const gate = deferred<Response>()
    const base = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => JSON.parse(init.body).type === 'delete' ? gate.promise : base(url, init))
    render(<CalendarView />); await openDelete()
    const button = screen.getByRole('button', { name: 'Placer dans la corbeille' })
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(writes()).toHaveLength(1))
    await act(async () => gate.resolve(Response.json(kind === 'refused' ? { calendarProtocol: 1, calendarOutcome: 'rejected-before-dispatch' } : {}, { status: 503 })))
    expect(await screen.findByRole('alert')).toHaveTextContent(kind === 'refused' ? 'Action refusée avant envoi' : 'Issue incertaine')
    expect(writes()).toHaveLength(1)
    confirmDelete()
    expect(writes()).toHaveLength(1)
  })
  it('keeps confirmed deletion despite reload failure and offers a read-only refresh', async () => {
    let reads = 0
    const base = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => JSON.parse(init.body).type === 'list' && ++reads === 2 ? Promise.reject(new Error('offline')) : base(url, init))
    render(<CalendarView />); await openDelete(); confirmDelete()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Événement supprimé')
    expect(alert).toHaveTextContent('agenda n’a pas pu être actualisé')
    expect(screen.queryByText(syntheticEvent.title)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Actualiser la liste/i }))
    await waitFor(() => expect(reads).toBe(3))
    expect(writes()).toHaveLength(1)
  })
  it('clears the old list and confirmation on relink without unmounting; no write to B', async () => {
    render(<CalendarView />); await openDelete()
    await act(async () => relinkCalendarGoogle('b'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Compte Google changé')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText(syntheticEvent.title)).not.toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    events = [{ ...syntheticEvent, title: 'B appointment' }]
    fireEvent.click(screen.getByRole('button', { name: /Actualiser/i }))
    expect(await screen.findByText('B appointment')).toBeInTheDocument()
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).calendarAccount).toBe('b@example.invalid')
  })
  it('does not publish a late initial list after unmount', async () => {
    const gate = deferred<Response>(); fetcher.mockReturnValue(gate.promise)
    const callback = vi.fn(), { unmount } = render(<CalendarView onEventsChange={callback} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); unmount()
    await act(async () => gate.resolve(Response.json({ events })))
    expect(callback).not.toHaveBeenCalled()
  })
  it('resets the UI incarnation when days changes during a pending write, without a permanent lock', async () => {
    const gate = deferred<Response>(), base = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => JSON.parse(init.body).type === 'delete' ? gate.promise : base(url, init))
    const { rerender } = render(<CalendarView days={7} />); await openDelete(); confirmDelete()
    await waitFor(() => expect(writes()).toHaveLength(1))
    rerender(<CalendarView days={14} />)
    const edit = await screen.findByRole('button', { name: /Modifier Synthetic/i })
    expect(edit).toBeEnabled()
    await act(async () => gate.resolve(Response.json({ success: true })))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(edit).toBeEnabled()
    fireEvent.click(edit)
    expect(screen.getByRole('textbox', { name: /Titre de l’événement/i })).toBeEnabled()
  })
  it('does not publish a late mutation after relink while Google may have written', async () => {
    const gate = deferred<Response>(), callback = vi.fn(), base = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, init) => JSON.parse(init.body).type === 'delete' ? gate.promise : base(url, init))
    render(<CalendarView onEventsChange={callback} />); await openDelete(); confirmDelete()
    await waitFor(() => expect(writes()).toHaveLength(1))
    await act(async () => relinkCalendarGoogle('b'))
    callback.mockClear()
    await act(async () => gate.resolve(Response.json({ success: true })))
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); expect(callback).not.toHaveBeenCalled()
  })
  it('keeps the original all-day date in the confirmation', async () => {
    events = [{ ...syntheticEvent, start: '2026-09-07', end: '2026-09-08' }]
    render(<CalendarView />); await openDelete()
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/7 sept\. 2026/)
    confirmDelete()
    expect(await screen.findByRole('status')).toHaveTextContent('Événement supprimé')
  })
})
