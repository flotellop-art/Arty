import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantBubble } from '../../components/chat/AssistantBubble'
import { captureCalendarContext } from '../../services/calendarClient'
import { createCalendarHandlers } from '../../services/tools/calendarTools'
import { created, resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
const content = '<button data-action="create_event" data-title="Synthetic appointment" data-start="2026-08-13T09:00" data-end="2026-08-13T10:00">Créer</button>'
beforeEach(resetCalendarFixture)
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('report Calendar button — no timed success', () => {
  it.each(['declined', 'unknown'] as const)('keeps the label after %s from the real handler', async outcome => {
    vi.spyOn(window, 'confirm').mockReturnValue(outcome !== 'declined')
    const fetcher = vi.fn().mockRejectedValue(new Error('Synthetic response lost')); vi.stubGlobal('fetch', fetcher)
    const handler = createCalendarHandlers().create_calendar_event
    let result = '', pending: Promise<void> | undefined
    const onAction = vi.fn((_name: string, params: Record<string, string>) => {
      pending = handler(params, { calendar: { scope: captureCalendarContext() } }).then(value => { result = value.result })
      return pending
    })
    render(<AssistantBubble content={content} onAction={onAction} />)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const button = screen.getByRole('button', { name: 'Créer', exact: true })
    fireEvent.click(button); await act(async () => pending)
    act(() => vi.advanceTimersByTime(2500))
    expect(button).toHaveTextContent('Créer')
    expect(screen.queryByText(/Fait !|En cours/)).not.toBeInTheDocument()
    expect(onAction).toHaveBeenCalledOnce(); expect(window.confirm).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledTimes(outcome === 'declined' ? 0 : 1)
    expect(result).toMatch(outcome === 'declined' ? /refusé/ : /incertaine/)
  })
  it('does not open a second proposal while the first response is pending', async () => {
    const response = deferred<Response>(), dispatched = deferred<void>()
    const fetcher = vi.fn(() => { dispatched.resolve(); return response.promise }); vi.stubGlobal('fetch', fetcher)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let pending: Promise<void> | undefined
    const handler = createCalendarHandlers().create_calendar_event
    const onAction = vi.fn((_name: string, params: Record<string, string>) => pending = handler(params, { calendar: { scope: captureCalendarContext() } }).then(() => {}))
    render(<AssistantBubble content={content} onAction={onAction} />)
    const button = screen.getByRole('button', { name: 'Créer', exact: true })
    fireEvent.click(button); fireEvent.click(button)
    await dispatched.promise
    expect(onAction).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce(); expect(window.confirm).toHaveBeenCalledOnce()
    await act(async () => { response.resolve(created()); await pending })
    expect(button).toHaveTextContent('Créer')
  })
  it('keeps historical content inert even if an action is injected into its DOM', () => {
    const onAction = vi.fn()
    render(<AssistantBubble content={content} historical onAction={onAction} />)
    const label = screen.getByText('Créer')
    const forged = document.createElement('button'); forged.dataset.action = 'create_event'; forged.textContent = 'Forged'
    label.parentElement!.append(forged); fireEvent.click(forged)
    expect(onAction).not.toHaveBeenCalled()
  })
  it('leaves other report feedback unchanged', () => {
    const onAction = vi.fn()
    render(<AssistantBubble content={'<button data-action="search_web" data-query="synthetic">Chercher</button>'} onAction={onAction} />)
    vi.useFakeTimers(); fireEvent.click(screen.getByRole('button', { name: 'Chercher' }))
    act(() => vi.advanceTimersByTime(2500))
    expect(screen.getByText('✅ Fait !')).toBeInTheDocument(); expect(onAction).toHaveBeenCalledOnce()
  })
})
