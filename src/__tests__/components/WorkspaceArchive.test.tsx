import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { Conversation } from '../../types'
import type { ArchiveReport, PreparedConversationArchive } from '../../services/workspaceBackup/capture'
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), verify: vi.fn(), download: vi.fn() }))
vi.mock('../../services/workspaceBackup/capture', () => ({ prepareConversationArchive: mocks.prepare, verifyWorkspaceArchive: mocks.verify, backupErrorCode: (error: { code?: string }) => error.code ?? 'unavailable' }))
vi.mock('../../services/native/shareFile', () => ({ downloadOrShareFile: mocks.download }))
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }) }))
import { ConversationArchiveModal } from '../../components/workspace/ConversationArchiveModal'
import { ArchiveVerifier } from '../../components/workspace/ArchiveVerifier'
import { SettingsModal } from '../../components/settings/SettingsModal'
import { ChatTopBar } from '../../components/chat/ChatTopBar'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
import * as mailNative from '../../services/native/mailImap'
import * as mailAccounts from '../../services/mailAccounts'

const conversation: Conversation = { id: 'c', title: 'Synthetic conversation', messages: [], createdAt: 1, updatedAt: 1, projectId: 'p' }
const report: ArchiveReport = { archiveId: 'synthetic-archive', createdAt: 1, version: 2, fingerprint: 'a'.repeat(64), conversations: 1, messages: 2, files: 0, projects: 0, documents: 0, bytes: 0, metadataVariants: 0, diagnostics: { unavailableAssociatedProjects: 0, unavailableHistoricalSources: 0, unavailableCropSources: 0 } }
let prepared: PreparedConversationArchive
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => { resolve = r }), resolve } }
const click = (key: string) => fireEvent.click(screen.getByRole('button', { name: key }))
async function create() { click('workspaceArchive.prepare'); await screen.findByDisplayValue(prepared.recoveryCode) }
function selectArchive() {
  fireEvent.change(screen.getByLabelText('workspaceArchive.file'), { target: { files: [new File(['ciphertext'], 'saved.artybackup')] } })
  fireEvent.change(screen.getAllByLabelText('workspaceArchive.code').at(-1)!, { target: { value: 'SEPARATE-CODE' } })
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  prepared = { archive: new Blob(['ciphertext']), recoveryCode: 'SYNTHETIC-SECRET-CODE', report, filename: 'opaque.artybackup', assertCurrent: vi.fn(), validate: vi.fn(async () => {}), dispose: vi.fn(), verify: vi.fn(async () => report) }
  mocks.prepare.mockResolvedValue(prepared); mocks.verify.mockResolvedValue(report)
  mocks.download.mockImplementation(async (_blob, _name, opts) => { opts.assertCurrent(); await opts.validate(); opts.onEngaged() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

describe('encrypted archive user flow', () => {
  it('requires an explicit project choice and separate-code acknowledgement; does not pass the code to download', async () => {
    const isBusy = vi.fn(() => false)
    render(<ConversationArchiveModal conversation={conversation} isBusy={isBusy} onClose={() => {}} />)
    expect(mocks.prepare).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('workspaceArchive.includeProject'))
    await create()
    expect(mocks.prepare.mock.calls[0]![1].includeProject).toBe(true)
    expect(screen.getByRole('button', { name: 'workspaceArchive.download' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('workspaceArchive.agree')); click('workspaceArchive.download')
    await screen.findByText('workspaceArchive.engaged')
    expect(mocks.download).toHaveBeenCalledWith(prepared.archive, prepared.filename, expect.objectContaining({ assertCurrent: prepared.assertCurrent, validate: prepared.validate }))
    expect(JSON.stringify(mocks.download.mock.calls)).not.toContain(prepared.recoveryCode)
    expect(screen.queryByText('workspaceArchive.verifiedSame')).toBeNull()
    selectArchive(); click('workspaceArchive.verify')
    await screen.findByText('workspaceArchive.verifiedSame')
    expect(prepared.verify).toHaveBeenCalledWith(expect.any(File), 'SEPARATE-CODE', expect.any(AbortSignal))
  })
  it('allows retry with the current authoritative busy getter, not an idle snapshot', async () => {
    let busy = true
    mocks.prepare.mockImplementation(async (_id, options) => { if (options.isBusy('c')) throw { code: 'busy' }; return prepared })
    render(<ConversationArchiveModal conversation={conversation} isBusy={() => busy} onClose={() => {}} />)
    click('workspaceArchive.prepare'); await screen.findByText('workspaceArchive.errors.busy')
    busy = false; await create()
    expect(mocks.prepare).toHaveBeenCalledTimes(2)
  })
  it('aborts a pending capture on close and disposes a late result without rendering it', async () => {
    const pending = deferred<PreparedConversationArchive>(), close = vi.fn(); mocks.prepare.mockReturnValue(pending.promise)
    render(<ConversationArchiveModal conversation={conversation} isBusy={() => false} onClose={close} />)
    click('workspaceArchive.prepare'); click('common.close')
    expect(mocks.prepare.mock.calls[0]![1].signal.aborted).toBe(true)
    await act(async () => { pending.resolve(prepared); await pending.promise })
    expect(prepared.dispose).toHaveBeenCalled(); expect(screen.queryByDisplayValue(prepared.recoveryCode)).toBeNull()
  })
  it('revokes displayed code and report in a still-mounted view and never re-arms it after invalidation', async () => {
    render(<ConversationArchiveModal conversation={conversation} isBusy={() => false} onClose={() => {}} />)
    await create(); expect(screen.getByDisplayValue(prepared.recoveryCode)).toBeVisible()
    act(() => invalidateLocalDataViews())
    expect(screen.queryByDisplayValue(prepared.recoveryCode)).toBeNull()
    expect(screen.queryByRole('button', { name: 'workspaceArchive.download' })).toBeNull()
    expect(screen.queryByText('workspaceArchive.counts')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('workspaceArchive.errors.cancelled')
    act(() => invalidateLocalDataViews()); expect(mocks.prepare).toHaveBeenCalledOnce()
  })
  it('focuses the first control after preparing and restarting, preserving both Tab boundaries', async () => {
    render(<ConversationArchiveModal conversation={conversation} isBusy={() => false} onClose={() => {}} />)
    screen.getByRole('button', { name: 'workspaceArchive.prepare' }).focus(); await create()
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    click('workspaceArchive.restart'); expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.close' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'workspaceArchive.prepare' }))
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.close' }))
  })
  it('clears a stale verification result on new input and cancels pending verification on invalidation', async () => {
    render(<ArchiveVerifier />); selectArchive(); click('workspaceArchive.verify')
    await screen.findByText('workspaceArchive.verified')
    const pending = deferred<ArchiveReport>(); mocks.verify.mockReturnValueOnce(pending.promise)
    fireEvent.change(screen.getByLabelText('workspaceArchive.code'), { target: { value: 'NEXT-CODE' } })
    expect(screen.queryByText('workspaceArchive.verified')).toBeNull(); click('workspaceArchive.verify')
    const signal = mocks.verify.mock.calls.at(-1)![2]
    act(() => invalidateLocalDataViews())
    expect(signal.aborted).toBe(true); expect(screen.queryByLabelText('workspaceArchive.file')).toBeNull()
    expect(screen.queryByDisplayValue('NEXT-CODE')).toBeNull()
    await act(async () => { pending.resolve(report); await pending.promise })
    expect(screen.queryByText('workspaceArchive.verified')).toBeNull()
  })
  it('keeps the verifier inside the one Settings dialog and resets it on close/reopen', async () => {
    const { rerender } = render(<SettingsModal open onClose={() => {}} />)
    screen.getByRole('button', { name: 'workspaceArchive.verifyTitle' }).focus(); click('workspaceArchive.verifyTitle')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    selectArchive(); click('workspaceArchive.backSettings')
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    click('workspaceArchive.verifyTitle'); expect(screen.getByLabelText('workspaceArchive.code')).toHaveValue('')
    rerender(<SettingsModal open={false} onClose={() => {}} />); rerender(<SettingsModal open onClose={() => {}} />)
    expect(screen.queryByLabelText('workspaceArchive.file')).toBeNull()
  })
  it('does not let the Settings parent steal Tab from an existing sibling mail dialog', async () => {
    vi.spyOn(mailNative, 'isMailImapAvailable').mockReturnValue(true)
    vi.spyOn(mailAccounts, 'refreshMailAccounts').mockResolvedValue([])
    render(<SettingsModal open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /mailAccountsModal.settingsTitle/ }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
    const child = screen.getAllByRole('dialog')[1]!, select = child.querySelector<HTMLInputElement>('input[type="email"]')!
    select.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => { select.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(select)
  })
  it.each([true, false])('closes the %s conversation menu before launching archive UI', async sheet => {
    localStorage.setItem('arty-chat-sheet-v2', sheet ? '1' : '0')
    const archive = vi.fn()
    render(<MemoryRouter><ChatTopBar title="Synthetic" onBack={() => {}} conversation={conversation} onArchive={archive} /></MemoryRouter>)
    if (sheet) fireEvent.click(screen.getByLabelText('chat.optionsSheet.open'))
    else fireEvent.click(screen.getByLabelText('chat.topBar.aria.export'))
    fireEvent.click(screen.getByText('workspaceArchive.title'))
    await waitFor(() => { expect(archive).toHaveBeenCalledOnce(); expect(screen.queryByRole(sheet ? 'dialog' : 'menu')).toBeNull() })
  })
})
