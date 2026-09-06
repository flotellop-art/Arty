import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/workspaceLocks'
import type { prepareRestorePublication } from '../../services/workspaceBackup/restorePublication'
import { BackupError } from '../../services/workspaceBackup/types'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), migration: vi.fn(), resume: vi.fn(), abort: vi.fn(), createRestore: vi.fn(),
  enabled: true, start: true, native: false, isolated: true, phase: 'copies', controller: new AbortController() }))
vi.mock('../../services/workspaceBackup/restorePublication', () => ({ prepareRestorePublication: mocks.prepare }))
vi.mock('../../services/workspaceWriter/migration', () => ({ createColdWorkspaceMigration: () => ({ start: mocks.migration }) }))
vi.mock('../../services/workspaceWriter/restore', () => ({ createColdWorkspaceRestore: mocks.createRestore }))
vi.mock('../../services/workspaceWriter/activation', () => ({ get ISOLATED_WORKSPACE_ENABLED() { return mocks.enabled }, get WORKSPACE_RESTORE_START_ENABLED() { return mocks.start } }))
vi.mock('../../services/native/platform', () => ({ get isNative() { return mocks.native } }))
vi.mock('../../services/workspaceWriter/runtime', () => ({
  assertDocumentWorkspace() {}, documentStorageKey: (owner: string | null, slot: string) => owner ? `arty-${owner}-${slot}` : `arty-${slot}`,
  get documentWorkspaceSignal() { return mocks.controller.signal },
  getDocumentStorageLayout: () => ({ kind: mocks.isolated ? 'isolated-v1' : 'legacy-v1' }),
  workspaceAdmission: { getRestoreRecovery: () => ({ restore: { phase: mocks.phase } }) },
}))
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr' } }) }))
import { WorkspaceRestorer } from '../../components/workspace/WorkspaceRestorer'
import ColdWorkspaceSetup from '../../components/workspace/ColdWorkspaceSetup'
import ColdRestoreRecovery from '../../components/workspace/ColdRestoreRecovery'
import { SettingsModal } from '../../components/settings/SettingsModal'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
import * as users from '../../services/userSession'

type Prepared = Awaited<ReturnType<typeof prepareRestorePublication>>
let prepared: Prepared
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
function selectArchive() {
  fireEvent.change(screen.getByLabelText('workspaceArchive.file'), { target: { files: [new File(['synthetic ciphertext'], 'synthetic.artybackup')] } })
  fireEvent.change(screen.getByLabelText('workspaceArchive.code'), { target: { value: 'SYNTHETIC-CODE' } })
}
async function preview() { selectArchive(); click('workspaceRestore.preview'); await screen.findByRole('checkbox', { name: 'workspaceRestore.consent' }) }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); mocks.controller = new AbortController(); mocks.enabled = true; mocks.start = true; mocks.native = false; mocks.isolated = true; mocks.phase = 'copies'
  vi.spyOn(users, 'getActiveSession').mockReturnValue({ userId: 'a', displayName: 'Synthetic account', authMethod: 'apikey', createdAt: 1 })
  prepared = { preview: { conversations: 1, messages: 1, files: 2, projects: 1, documents: 1, sourceBytes: 10, bytes: 20,
    addedConversations: 2, addedMessages: 2, receiptFiles: 1, targetOwner: 'a', journalBytes: 50,
    diagnostics: { unavailableAssociatedProjects: 0, unavailableHistoricalSources: 0, unavailableCropSources: 0 } }, dispose: vi.fn(), commit: vi.fn(async () => {}) } as unknown as Prepared
  mocks.prepare.mockResolvedValue(prepared); mocks.migration.mockResolvedValue(undefined); mocks.resume.mockResolvedValue(undefined); mocks.abort.mockResolvedValue(undefined)
  mocks.createRestore.mockReturnValue({ resume: mocks.resume, abort: mocks.abort })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

it.each(['disabled', 'start-disabled', 'native', 'demo', 'legacy'] as const)('%s is explained before any archive/code input or writer call', mode => {
  if (mode === 'disabled') mocks.enabled = false
  if (mode === 'start-disabled') mocks.start = false
  if (mode === 'native') mocks.native = true
  if (mode === 'demo') vi.mocked(users.getActiveSession).mockReturnValue({ userId: 'demo', displayName: 'Demo', authMethod: 'demo', createdAt: 1 })
  if (mode === 'legacy') mocks.isolated = false
  render(<WorkspaceRestorer />)
  expect(screen.queryByLabelText('workspaceArchive.file')).toBeNull(); expect(screen.queryByLabelText('workspaceArchive.code')).toBeNull()
  expect(mocks.prepare).not.toHaveBeenCalled()
  if (mode === 'legacy') expect(screen.getByRole('link', { name: 'workspaceRestore.setupTitle' })).toHaveAttribute('href', '/workspace/prepare')
  else expect(screen.getByRole('note')).toBeVisible()
})
it('focuses the preview heading, clears the secret, shows bound owner and receipt, and requires explicit consent', async () => {
  render(<WorkspaceRestorer />); expect(mocks.prepare).not.toHaveBeenCalled(); await preview()
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'workspaceRestore.title' }))
  expect(screen.queryByDisplayValue('SYNTHETIC-CODE')).toBeNull(); expect(screen.queryByLabelText('workspaceArchive.file')).toBeNull()
  expect(screen.getByText('"a"')).toBeVisible(); expect(screen.getByText('workspaceRestore.receiptNotice')).toBeVisible()
  expect(screen.getByRole('button', { name: 'workspaceRestore.commit' })).toBeDisabled(); expect(prepared.commit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox')); click('workspaceRestore.commit')
  await screen.findByRole('button', { name: 'workspaceRestore.preview' }); expect(prepared.commit).toHaveBeenCalledOnce()
})
it('binds a double submit to one commit while adoption is pending', async () => {
  const pending = deferred(); vi.mocked(prepared.commit).mockReturnValue(pending.promise)
  render(<WorkspaceRestorer />); await preview(); fireEvent.click(screen.getByRole('checkbox'))
  const submit = screen.getByRole('button', { name: 'workspaceRestore.commit' }); fireEvent.click(submit); fireEvent.click(submit)
  expect(prepared.commit).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'workspaceArchive.restart' })).toBeDisabled()
  await act(async () => { pending.resolve(); await pending.promise })
})
it('allows a fresh preparation after a failed pre-adoption commit, without reusing the consumed preview', async () => {
  vi.mocked(prepared.commit).mockRejectedValueOnce(new BackupError('changed'))
  render(<WorkspaceRestorer />); await preview(); fireEvent.click(screen.getByRole('checkbox')); click('workspaceRestore.commit')
  expect(await screen.findByRole('alert')).toHaveTextContent('workspaceRestore.errors.changed'); expect(prepared.dispose).toHaveBeenCalled()
  await preview(); fireEvent.click(screen.getByRole('checkbox')); click('workspaceRestore.commit')
  await screen.findByRole('button', { name: 'workspaceRestore.preview' }); expect(prepared.commit).toHaveBeenCalledTimes(2); expect(mocks.prepare).toHaveBeenCalledTimes(2)
})
it('aborts pending preparation on unmount and disposes a late result without exposing it', async () => {
  const pending = deferred<Prepared>(); mocks.prepare.mockReturnValue(pending.promise)
  const view = render(<WorkspaceRestorer />); selectArchive(); click('workspaceRestore.preview')
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce()); const signal = mocks.prepare.mock.calls[0]![3]
  view.unmount(); expect(signal.aborted).toBe(true)
  await act(async () => { pending.resolve(prepared); await pending.promise }); expect(prepared.dispose).toHaveBeenCalledOnce()
})
it.each(['account', 'document'] as const)('terminal %s invalidation removes every input/preview and disables further publication', async reason => {
  render(<WorkspaceRestorer />); await preview()
  act(() => reason === 'document' ? mocks.controller.abort() : invalidateLocalDataViews())
  expect(prepared.dispose).toHaveBeenCalled(); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByLabelText('workspaceArchive.code')).toBeNull()
  expect(screen.getByRole('alert')).toHaveTextContent('workspaceArchive.errors.cancelled'); expect(prepared.commit).not.toHaveBeenCalled()
})
it('keeps restore inside the one Settings dialog with keyboard boundaries and resets it when closed', async () => {
  const view = render(<SettingsModal open onClose={() => {}} />); click('workspaceRestore.title'); await preview()
  const dialog = screen.getByRole('dialog'); expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(dialog.contains(document.activeElement)).toBe(true)
  const restart = screen.getByRole('button', { name: 'workspaceArchive.restart' }); restart.focus(); fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'common.close' }))
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(restart)
  click('workspaceArchive.backSettings'); expect(prepared.dispose).toHaveBeenCalled(); click('workspaceRestore.title')
  expect(screen.getByLabelText('workspaceArchive.code')).toHaveValue('')
  await act(async () => { view.rerender(<SettingsModal open={false} onClose={() => {}} />) })
  await act(async () => { view.rerender(<SettingsModal open onClose={() => {}} />) })
  expect(screen.queryByLabelText('workspaceArchive.file')).toBeNull()
})
it('cold setup is inert on mount and accepts only one explicit start; success links to a full new document', async () => {
  const pending = deferred(); mocks.migration.mockReturnValue(pending.promise)
  render(<ColdWorkspaceSetup />); expect(mocks.migration).not.toHaveBeenCalled()
  const start = screen.getByRole('button', { name: 'workspaceRestore.setupStart' }); fireEvent.click(start); fireEvent.click(start)
  await vi.waitFor(() => expect(mocks.migration).toHaveBeenCalledOnce()); expect(screen.queryByRole('link')).toBeNull()
  await act(async () => { pending.resolve(); await pending.promise }); await screen.findByText('workspaceRestore.setup.done')
  expect(screen.getByRole('link')).toHaveAttribute('href', '/?start=1'); expect(screen.queryByRole('button')).toBeNull()
})
it.each(['disabled', 'start-disabled', 'native'])('cold setup %s never offers migration', mode => {
  if (mode === 'disabled') mocks.enabled = false; else if (mode === 'start-disabled') mocks.start = false; else mocks.native = true
  render(<ColdWorkspaceSetup />); expect(screen.queryByRole('button')).toBeNull(); expect(mocks.migration).not.toHaveBeenCalled()
})
it.each(['copies', 'publishing', 'aborting'])('cold recovery %s is read-only until an explicit action and never offers roll-forward after aborting', async phase => {
  mocks.phase = phase; render(<ColdRestoreRecovery />); expect(mocks.createRestore).not.toHaveBeenCalled()
  if (phase === 'aborting') expect(screen.queryByRole('button', { name: 'workspaceRestore.resume' })).toBeNull()
  click(phase === 'aborting' ? 'workspaceRestore.continueAbort' : 'workspaceRestore.reviewAbort')
  expect(mocks.createRestore).not.toHaveBeenCalled(); click('workspaceRestore.confirmAbort')
  await screen.findByText('workspaceRestore.recovery.done'); expect(mocks.abort).toHaveBeenCalledOnce(); expect(mocks.resume).not.toHaveBeenCalled()
  expect(screen.getByRole('link')).toHaveAttribute('href', '/?start=1')
})
it('cold recovery failure never retries in the same document or imports a private application', async () => {
  mocks.resume.mockRejectedValue(new Error('synthetic failure')); render(<ColdRestoreRecovery />); click('workspaceRestore.resume')
  await screen.findByText('workspaceRestore.recovery.failed'); expect(screen.queryByRole('button')).toBeNull(); expect(mocks.resume).toHaveBeenCalledOnce()
})
