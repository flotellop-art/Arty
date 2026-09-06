import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarDocumentCopyDialog } from '../../components/chat/CalendarDocumentCopyDialog'
import { useCalendarDocumentCopy } from '../../components/chat/useCalendarDocumentCopy'
import { MessageList } from '../../components/chat/MessageList'
import { copyConversation, copyText, resetCalendarCopyFixture } from '../helpers/calendarCopyFixture'
import { created, google, relinkCalendarGoogle } from '../helpers/calendarFixture'
import { saveConversation, deleteConversation } from '../../services/storage'
import { deferred } from '../helpers/workspaceLocks'
import { initCrypto } from '../../services/crypto'
import * as copies from '../../services/workflows/calendarDocumentCopy'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
function Harness({ id = 'document-copy' }: { id?: string }) {
  const copy = useCalendarDocumentCopy(id, () => false)
  return <><button onClick={() => copy.open('source-answer')}>Open fixture</button>
    {copy.opening && <CalendarDocumentCopyDialog key={copy.opening.key} opening={copy.opening} onClose={copy.close} />}</>
}
beforeEach(async () => { await resetCalendarCopyFixture(); vi.stubGlobal('fetch', vi.fn(async () => created())) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function open() { fireEvent.click(screen.getByText('Open fixture')); return screen.findByRole('button', { name: 'Utiliser cette copie comme brouillon' }) }
async function adopt() { fireEvent.click(await open()); await screen.findByRole('button', { name: 'Relire les champs à envoyer' }) }
function fill() {
  fireEvent.change(screen.getByLabelText(/^Titre/), { target: { value: 'Appointment' } })
  fireEvent.change(screen.getByLabelText(/^Début/), { target: { value: '2026-08-13T09:00' } })
  fireEvent.change(screen.getByLabelText(/^Fin/), { target: { value: '2026-08-13T10:00' } })
}
function review() { fill(); fireEvent.click(screen.getByRole('button', { name: 'Relire les champs à envoyer' })) }

describe('calendar copy lifetime and explicit consent UI, real grants/IDB/HTTP boundary', () => {
  it('works through StrictMode, keeps source markup inert, leaves fields empty and sends nothing on cancel', async () => {
    render(<StrictMode><Harness /></StrictMode>); await adopt()
    expect(screen.getByLabelText(/^Texte source/)).toHaveValue(copyText)
    expect(screen.queryByRole('button', { name: 'NE PAS EXÉCUTER' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Titre/)).toHaveValue(''); expect(screen.getByLabelText(/^Début/)).toHaveValue('')
    expect(document.querySelector('[data-action]')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled()
  })
  it('copies only the explicit selection into notes, reviews exact text, edits revoke confirmation and double-click sends once', async () => {
    render(<Harness />); await adopt()
    const source = screen.getByLabelText(/^Texte source/) as HTMLTextAreaElement
    source.setSelectionRange(0, 19); fireEvent.click(screen.getByRole('button', { name: 'Ajouter le texte sélectionné aux notes' }))
    expect(screen.getByLabelText(/^Notes/)).toHaveValue(copyText.slice(0, 19))
    review(); expect(screen.getByText(/2026-08-13T09:00:00\+02:00/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Modifier le brouillon' }))
    expect(screen.queryByRole('button', { name: 'Confirmer et créer ce rendez-vous' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^Titre/), { target: { value: 'Final title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Relire les champs à envoyer' }))
    const confirm = screen.getByRole('button', { name: 'Confirmer et créer ce rendez-vous' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    await screen.findByText('Création confirmée par Google. Le brouillon local a été effacé.')
    expect(fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toMatchObject({ title: 'Final title', description: copyText.slice(0, 19) })
    expect(screen.queryByDisplayValue(copyText)).not.toBeInTheDocument()
  })
  it('rejects an overlong note with no truncation and no POST', async () => {
    render(<Harness />); await adopt(); fill()
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: 'a'.repeat(8193) } })
    fireEvent.click(screen.getByRole('button', { name: 'Relire les champs à envoyer' }))
    expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.getByLabelText(/^Notes/)).toHaveValue('a'.repeat(8193)); expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps a confirmed result confirmed after relinking, with no private content or second request', async () => {
    render(<Harness />); await adopt(); review()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer et créer ce rendez-vous' }))
    await screen.findByText('Création confirmée par Google. Le brouillon local a été effacé.')
    await act(async () => relinkCalendarGoogle('b'))
    expect(screen.getByText('Création confirmée par Google. Le brouillon local a été effacé.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByDisplayValue(copyText)).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce()
  })
  it('does not downgrade a confirmed result when an older readonly poll fails late', async () => {
    const real = copies.captureCalendarDocumentCopy, gate = deferred<void>(), started = deferred<void>()
    let hold = false
    vi.spyOn(copies, 'captureCalendarDocumentCopy').mockImplementation((...args) => {
      const actor = real(...args), wrapped = Object.create(actor)
      Object.defineProperty(wrapped, 'validate', { value: async () => { if (hold) { hold = false; started.resolve(); await gate.promise } else await actor.validate() } })
      return wrapped
    })
    render(<Harness />); await adopt(); review(); hold = true
    await started.promise
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer et créer ce rendez-vous' }))
    await screen.findByText('Création confirmée par Google. Le brouillon local a été effacé.')
    await act(async () => gate.reject(new Error('old read failed')))
    expect(screen.getByText('Création confirmée par Google. Le brouillon local a été effacé.')).toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('accepts an explicit offset for the ambiguous autumn hour', async () => {
    render(<Harness />); await adopt(); fill()
    fireEvent.change(screen.getByLabelText(/^Début/), { target: { value: '2026-10-25T02:30+02:00' } })
    fireEvent.change(screen.getByLabelText(/^Fin/), { target: { value: '2026-10-25T02:30+01:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Relire les champs à envoyer' }))
    expect(screen.getByRole('button', { name: 'Confirmer et créer ce rendez-vous' })).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled()
  })
  it('clears a source changed before adoption but retains an adopted copy after source deletion', async () => {
    render(<Harness />); await open()
    act(() => { const source = copyConversation(); source.title = 'Changed'; saveConversation(source) })
    await screen.findByRole('alert'); expect(screen.queryByDisplayValue(copyText)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' })); await adopt()
    act(() => deleteConversation('document-copy'))
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(screen.getByLabelText(/^Texte source/)).toHaveValue(copyText); expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it.each(['relink', 'crypto'])('immediately clears private fields after %s, never revives old consent', async reason => {
    render(<Harness />); await adopt(); review()
    await act(async () => { if (reason === 'relink') await relinkCalendarGoogle('b'); else await initCrypto('synthetic-new-key') })
    expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.queryByText(/Appointment/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmer et créer ce rendez-vous' })).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled()
  })
  it('notifies UI at the beginning of a suspended token installation', async () => {
    render(<Harness />); await adopt(); review()
    const gate = deferred<ArrayBuffer>(), real = crypto.subtle.encrypt.bind(crypto.subtle)
    const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => { const result = await real(...args); await gate.promise; return result })
    let installing!: Promise<boolean>
    act(() => { installing = google.storeTokens({ access_token: 'synthetic-replacement', expires_at: Date.now() + 3600000 }) })
    expect(screen.getByRole('alert')).toBeInTheDocument(); expect(screen.queryByText(/Appointment/)).not.toBeInTheDocument()
    await act(async () => { gate.resolve(new ArrayBuffer(0)); await installing }); spy.mockRestore(); expect(fetch).not.toHaveBeenCalled()
  })
  it('unknown is terminal, no retry, and closing while pending never claims remote cancellation', async () => {
    const gate = deferred<Response>(); vi.mocked(fetch).mockImplementation(() => gate.promise)
    render(<Harness />); await adopt(); review()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer et créer ce rendez-vous' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(screen.getByText(/fermer cette fenêtre ne supprime pas/)).toBeInTheDocument()
    await act(async () => gate.reject(new Error('response lost')))
    expect(screen.getByRole('alert')).toHaveTextContent(/incertaine/); expect(screen.queryByDisplayValue(copyText)).not.toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' })); await open()
    expect(screen.queryByRole('button', { name: 'Confirmer et créer ce rendez-vous' })).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce()
  })
  it('closes and releases old authority on route identity changes and unmount', async () => {
    const view = render(<Harness />); await adopt(); review()
    view.rerender(<Harness id="other" />); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<Harness />); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await open(); view.unmount(); expect(fetch).not.toHaveBeenCalled()
  })
  it('recovers dialog focus from the background and from the dialog root', async () => {
    render(<Harness />); await adopt()
    act(() => screen.getByText('Open fixture').focus())
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)
    act(() => screen.getByRole('dialog').focus())
    expect(document.activeElement?.tagName).toBe('BUTTON')
  })
  it('exposes the fixed action only for completed stored assistant messages, allowing orphan pending but never live/interrupted', () => {
    const source = copyConversation(), action = vi.fn()
    source.messages.push({ ...source.messages[1]!, id: 'cut', interrupted: true },
      { ...source.messages[1]!, id: 'pending', factCheck: { status: 'pending', claims: [], modelLabel: '', checkedAt: 0, overallConfidence: 'low' } },
      { ...source.messages[1]!, id: 'streaming' })
    const view = render(<MessageList messages={source.messages} isStreaming={false} streamingContent="" onCalendarCopy={action} />)
    const actions = screen.getAllByRole('button', { name: 'Copie vers Agenda' }); expect(actions).toHaveLength(2)
    fireEvent.click(actions[0]!); expect(action).toHaveBeenCalledExactlyOnceWith('source-answer')
    view.rerender(<MessageList messages={source.messages} isStreaming streamingContent="live" onCalendarCopy={action} />)
    expect(screen.queryByRole('button', { name: 'Copie vers Agenda' })).not.toBeInTheDocument()
  })
})
