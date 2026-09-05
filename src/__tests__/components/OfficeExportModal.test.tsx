import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const mock = vi.hoisted(() => ({ prepare: vi.fn(), deliver: vi.fn(), dispose: vi.fn(), owner: 'a', epoch: 1, native: false }))
vi.mock('../../services/officeExport/session', () => ({ prepareOfficeExport: mock.prepare }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => mock.owner, getActiveSessionEpoch: () => mock.epoch }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native } }))
import { OfficeExportModal } from '../../components/chat/OfficeExportModal'
const conv: Conversation = { id: 'c', title: 'Test', createdAt: 1, updatedAt: 1, messages: [] }
function document(withTable = true) { return { title: 'Test', chars: 20, omissions: { images: 1, html: 1, unsupported: 0, attachments: 2 }, messages: [{ id: 'm', role: 'assistant', model: 'model', interrupted: true, sources: ['[S1] privée'], blocks: [{ kind: 'paragraph', runs: [{ text: 'CONTENU PRIVÉ' }] }, ...(withTable ? [{ kind: 'table', id: 'table-1', rows: [['Code', 'Valeur'], ['0012', '=1+1']], message: 1 }] : [])] }] } }
beforeEach(() => { vi.clearAllMocks(); mock.owner = 'a'; mock.epoch = 1; mock.native = false; mock.prepare.mockResolvedValue({ document: document(), deliver: mock.deliver, dispose: mock.dispose }); mock.deliver.mockResolvedValue(undefined) })
afterEach(cleanup)
describe('editable export review UI', () => {
  it('requires explicit consent and clears consent when switching format/table scope', async () => {
    render(<OfficeExportModal conversation={conv} messageId="m" onClose={vi.fn()} />)
    await screen.findByText(/1 message/)
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeDisabled()
    expect(screen.getByText(/potentiellement incomplète/)).toBeVisible()
    fireEvent.click(screen.getByLabelText(/J’ai vérifié/))
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeEnabled()
    fireEvent.click(screen.getByLabelText('Excel (.xlsx)'))
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/J’ai vérifié/)); fireEvent.click(screen.getByRole('button', { name: 'Télécharger' }))
    await waitFor(() => expect(mock.deliver).toHaveBeenCalledWith({ format: 'xlsx', tableIds: ['table-1'] }, expect.any(Function)))
  })
  it('empty table selection cannot produce a fake spreadsheet', async () => {
    mock.prepare.mockResolvedValue({ document: document(false), deliver: mock.deliver, dispose: mock.dispose })
    render(<OfficeExportModal conversation={conv} onClose={vi.fn()} />)
    await screen.findByText(/1 message/); fireEvent.click(screen.getByLabelText('Excel (.xlsx)'))
    expect(screen.getByText(/Aucun tableau Markdown/)).toBeVisible()
    fireEvent.click(screen.getByLabelText(/J’ai vérifié/)); expect(screen.getByRole('button', { name: 'Télécharger' })).toBeDisabled()
  })
  it('Escape aborts before an async preview resolves and disposes its late session', async () => {
    let resolve!: (value: unknown) => void
    mock.prepare.mockReturnValue(new Promise(r => { resolve = r }))
    const close = vi.fn(); render(<OfficeExportModal conversation={conv} onClose={close} />)
    fireEvent.keyDown(documentGlobal(), { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce(); expect(mock.prepare.mock.calls[0][2].aborted).toBe(true)
    await act(async () => resolve({ document: document(), deliver: mock.deliver, dispose: mock.dispose }))
    expect(mock.dispose).toHaveBeenCalled(); expect(screen.queryByText('CONTENU PRIVÉ')).toBeNull()
  })
  it('invalid scope clears private preview and consent', async () => {
    render(<OfficeExportModal conversation={conv} onClose={vi.fn()} />)
    await screen.findByText(/1 message/)
    fireEvent.click(screen.getByLabelText(/J’ai vérifié/))
    act(() => mock.prepare.mock.calls[0][3]())
    expect(screen.queryByText('CONTENU PRIVÉ')).toBeNull()
    expect(screen.getByRole('button', { name: 'Télécharger' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Aperçu annulé')
  })
  it('hides the previous account immediately on rerender before remount', async () => {
    const view = render(<OfficeExportModal conversation={conv} onClose={vi.fn()} />)
    await screen.findByText(/1 message/)
    mock.owner = 'b'; mock.epoch++
    view.rerender(<OfficeExportModal conversation={conv} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('native handoff is not labelled saved and cancellation during delivery stays active', async () => {
    mock.native = true
    let finish!: () => void
    mock.deliver.mockImplementation(async (_choices, engaged) => { engaged(); await new Promise<void>(r => { finish = r }) })
    const close = vi.fn(); render(<OfficeExportModal conversation={conv} onClose={close} />)
    await screen.findByText(/1 message/); fireEvent.click(screen.getByLabelText(/J’ai vérifié/))
    fireEvent.click(screen.getByRole('button', { name: 'Préparer le partage' }))
    await screen.findByText(/Transmission à la feuille/)
    expect(screen.getByLabelText(/J’ai vérifié/)).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(mock.prepare.mock.calls[0][2].aborted).toBe(true)
    await act(async () => finish())
    expect(screen.queryByText(/enregistré/i)).toBeNull()
  })
})
function documentGlobal() { return globalThis.document }
