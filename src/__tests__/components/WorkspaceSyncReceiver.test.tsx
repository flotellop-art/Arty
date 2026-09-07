import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ inspect: vi.fn(), unlockOrJoin: vi.fn(), receive: vi.fn(), prepareApply: vi.fn(), applyReceived: vi.fn(), close: vi.fn(), create: vi.fn(),
  resume: vi.fn(), pendingStatus: vi.fn(), reconcilePending: vi.fn(), abort: vi.fn(), eraseLocal: vi.fn(), cold: vi.fn(), enabled: true, phase: 'prepared', version: 10 }))
vi.mock('../../services/workspaceSync/activation', () => ({ get WORKSPACE_SYNC_APPLY_START_ENABLED() { return mocks.enabled } }))
vi.mock('../../services/workspaceWriter/runtime', () => ({ documentWorkspaceSignal: new AbortController().signal,
  getDocumentStorageLayout: () => ({ kind: 'isolated-v1', projects: { version: 2 } }), workspaceAdmission: { getSyncApplyRecovery: () => ({ version: mocks.version, apply: { phase: mocks.phase } }) } }))
vi.mock('../../services/workspaceSync/localOutbox', () => ({ createLocalSyncOutbox: mocks.create }))
vi.mock('../../services/workspaceWriter/syncApply', () => ({ createColdWorkspaceSyncApply: mocks.cold }))
vi.mock('../../services/native/platform', () => ({ isNative: false }))
vi.mock('../../services/userSession', () => ({ getActiveSession: () => ({ userId: 'a', authMethod: 'google' }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { WorkspaceSyncReceiver } from '../../components/workspace/WorkspaceSyncReceiver'
import ColdSyncApplyRecovery from '../../components/workspace/ColdSyncApplyRecovery'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
import { deferred } from '../helpers/workspaceLocks'
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true; mocks.phase = 'prepared'; mocks.version = 10
  mocks.create.mockReturnValue({ close: mocks.close, connect: () => mocks }); mocks.cold.mockReturnValue(mocks)
  mocks.inspect.mockResolvedValue({ status: 'active' }); mocks.unlockOrJoin.mockResolvedValue({}); mocks.receive.mockResolvedValue({})
  mocks.prepareApply.mockResolvedValue({ conversations: 1 }); mocks.applyReceived.mockResolvedValue({ status: 'reload-required' })
  mocks.resume.mockResolvedValue(undefined); mocks.abort.mockResolvedValue(undefined); mocks.eraseLocal.mockResolvedValue(undefined)
  mocks.pendingStatus.mockResolvedValue({ status: 'conflict' }); mocks.reconcilePending.mockResolvedValue({ status: 'reconciled-pending', conflicts: 1 })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
async function codeForm() { click('workspaceSyncApply.inspect'); return screen.findByLabelText('workspaceSyncApply.code') }
async function preview() {
  const code = await codeForm(); fireEvent.change(code, { target: { value: 'SYNTHETIC-CODE' } }); click('workspaceSyncApply.prepare')
  await screen.findByText('workspaceSyncApply.summary')
}
it('OFF neither exposes a start nor constructs an actor; cold completion remains available', async () => {
  mocks.enabled = false
  const warm = render(<WorkspaceSyncReceiver />); expect(warm.container).toBeEmptyDOMElement(); expect(mocks.create).not.toHaveBeenCalled(); warm.unmount()
  render(<ColdSyncApplyRecovery />); click('workspaceSyncApply.resume'); await screen.findByText('workspaceSyncApply.cold.done'); expect(mocks.resume).toHaveBeenCalledOnce()
})
it('synchronous double inspect and form submission start only one actor and one preparation', async () => {
  const inspect = deferred(), unlock = deferred(); mocks.inspect.mockImplementation(async () => { await inspect.promise; return { status: 'active' } }); mocks.unlockOrJoin.mockReturnValue(unlock.promise)
  render(<WorkspaceSyncReceiver />)
  const button = screen.getByRole('button', { name: 'workspaceSyncApply.inspect' })
  act(() => { fireEvent.click(button); fireEvent.click(button) })
  await act(async () => { inspect.resolve() })
  const code = await screen.findByLabelText('workspaceSyncApply.code'); expect(mocks.create).toHaveBeenCalledOnce()
  fireEvent.change(code, { target: { value: 'SYNTHETIC-CODE' } }); const form = code.closest('form')!
  act(() => { fireEvent.submit(form); fireEvent.submit(form) }); expect(mocks.unlockOrJoin).toHaveBeenCalledOnce()
  expect(screen.queryByDisplayValue('SYNTHETIC-CODE')).toBeNull()
  await act(async () => { unlock.resolve() }); await screen.findByText('workspaceSyncApply.summary'); expect(mocks.prepareApply).toHaveBeenCalledOnce()
})
it('invalidation discards a late inspection without exposing its code form', async () => {
  const pending = deferred(); mocks.inspect.mockImplementation(async () => { await pending.promise; return { status: 'active' } })
  render(<WorkspaceSyncReceiver />); click('workspaceSyncApply.inspect'); await act(async () => {})
  act(() => invalidateLocalDataViews()); await act(async () => { pending.resolve() })
  expect(screen.queryByLabelText('workspaceSyncApply.code')).toBeNull(); expect(mocks.close).toHaveBeenCalled()
})
it('unmount disposes actors and does not finish a delayed preparation', async () => {
  const pending = deferred(); mocks.unlockOrJoin.mockReturnValue(pending.promise)
  const view = render(<WorkspaceSyncReceiver />), code = await codeForm()
  fireEvent.change(code, { target: { value: 'CODE' } }); click('workspaceSyncApply.prepare'); view.unmount()
  await act(async () => { pending.resolve() }); expect(mocks.receive).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalled()
})
it('requires checked consent and makes an uncertain adoption terminal, never retries it', async () => {
  mocks.applyReceived.mockRejectedValue(new Error('lost acknowledgement'))
  render(<WorkspaceSyncReceiver />); await preview()
  expect(screen.getByRole('button', { name: 'workspaceSyncApply.apply' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText('workspaceSyncApply.consent')); click('workspaceSyncApply.apply')
  await screen.findByText('workspaceSyncApply.warm.failed'); expect(mocks.applyReceived).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'workspaceSyncApply.apply' })).toBeNull()
})
it('v11 cold recovery remains visible OFF and describes forward-only abandonment rather than deleting copies', async () => {
  mocks.enabled = false; mocks.version = 11
  render(<ColdSyncApplyRecovery />)
  expect(screen.getByText('workspaceSyncApply.update.choose')).toBeInTheDocument()
  click('workspaceSyncApply.abort'); expect(screen.getByText('workspaceSyncApply.update.confirmAbort')).toBeInTheDocument()
  expect(mocks.cold).not.toHaveBeenCalled()
  click('workspaceSyncApply.confirm'); await screen.findByText('workspaceSyncApply.cold.done'); expect(mocks.abort).toHaveBeenCalledOnce()
})
it.each([false, true])('existing-update preview exposes reasons and only offers confirmation when applicable: %s', async canApply => {
  mocks.prepareApply.mockResolvedValue({ status: 'existing-update-reviewed', canApply, conversations: canApply ? 1 : 0, projects: 0,
    targets: canApply ? [{ kind: 'conversation', localId: 'chosen-chat', before: 'Old title', after: 'New title' }] : [],
    retained: [{ recordId: 'remote-item', label: 'Modified locally', reason: 'local-change' }] })
  render(<WorkspaceSyncReceiver />); const code = await codeForm()
  fireEvent.change(code, { target: { value: 'CODE' } }); click('workspaceSyncApply.prepare')
  await screen.findByText('workspaceSyncApply.update.summary')
  expect(screen.getByText(/Modified locally.*workspaceSyncApply.update.reason.local-change/)).toBeInTheDocument()
  if (!canApply) {
    expect(screen.getByText('workspaceSyncApply.update.none')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull(); expect(mocks.applyReceived).not.toHaveBeenCalled()
  } else {
    expect(screen.getByRole('button', { name: 'workspaceSyncApply.update.apply' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('workspaceSyncApply.update.consent')); click('workspaceSyncApply.update.apply')
    await screen.findByText('workspaceSyncApply.warm.reload'); expect(mocks.applyReceived).toHaveBeenCalledOnce()
  }
})
it('separates applied targets from retained homonyms and renders exact escaped IDs, before and after as text', async () => {
  const id = `invisible\u200b\u202e ${'long'.repeat(80)}`
  mocks.prepareApply.mockResolvedValue({ status: 'existing-update-reviewed', canApply: true, conversations: 1, projects: 1,
    targets: [{ kind: 'conversation', localId: id, before: 'Same title', after: '<img src=x onerror=alert(1)>' },
      { kind: 'project', localId: 'invisible', before: 'Same title', after: '' }],
    retained: [{ recordId: 'other', label: 'Same title', reason: 'local-change' }] })
  render(<WorkspaceSyncReceiver />); const code = await codeForm()
  fireEvent.change(code, { target: { value: 'CODE' } }); click('workspaceSyncApply.prepare')
  const targets = await screen.findByRole('region', { name: 'workspaceSyncApply.update.targets' })
  expect(within(targets).getAllByText('Same title')).toHaveLength(2)
  expect(within(targets).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(targets.querySelector('img')).toBeNull()
  const identity = within(targets).getByText(`"invisible\\u200b\\u202e\\u0020${'long'.repeat(80)}"`)
  expect(identity).toHaveClass('break-all'); expect(identity).toHaveAttribute('dir', 'ltr')
  expect(within(targets).getByText('workspaceSyncApply.update.untitled')).toBeInTheDocument()
  const retained = screen.getByRole('region', { name: 'workspaceSyncApply.update.retained' })
  expect(within(retained).getByText(/Same title.*local-change/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'workspaceSyncApply.update.apply' })).toBeDisabled()
})
it.each([false, true])('explicit preview reread clears old consent immediately and never publishes (previous target: %s)', async hadTarget => {
  mocks.prepareApply.mockResolvedValue({ status: 'existing-update-reviewed', canApply: hadTarget, conversations: hadTarget ? 1 : 0, projects: 0,
    targets: hadTarget ? [{ kind: 'conversation', localId: 'first', before: 'Before', after: 'Old preview' }] : [], retained: [] })
  render(<WorkspaceSyncReceiver />); const code = await codeForm()
  fireEvent.change(code, { target: { value: 'CODE' } }); click('workspaceSyncApply.prepare')
  await screen.findByText('workspaceSyncApply.update.summary')
  if (hadTarget) fireEvent.click(screen.getByLabelText('workspaceSyncApply.update.consent'))
  const reading = deferred(); mocks.receive.mockReturnValueOnce(reading.promise)
  mocks.prepareApply.mockResolvedValue({ status: 'existing-update-reviewed', canApply: true, conversations: 1, projects: 0,
    targets: [{ kind: 'conversation', localId: 'next', before: 'Before', after: 'Fresh preview' }], retained: [] })
  const reread = screen.getByRole('button', { name: 'workspaceSyncApply.receiveAgain' })
  act(() => { fireEvent.click(reread); fireEvent.click(reread) })
  expect(mocks.receive).toHaveBeenCalledTimes(2); expect(screen.queryByText('Old preview')).toBeNull(); expect(screen.queryByRole('checkbox')).toBeNull()
  await act(async () => { reading.resolve({}) }); await screen.findByText('Fresh preview')
  expect(screen.getByLabelText('workspaceSyncApply.update.consent')).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'workspaceSyncApply.update.apply' })).toBeDisabled()
  expect(mocks.applyReceived).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled()
})
it('offers a normal-save instruction rather than an endless reload for nondurable legacy history', async () => {
  mocks.prepareApply.mockRejectedValue(new Error('history-not-durable'))
  render(<WorkspaceSyncReceiver />); const code = await codeForm()
  fireEvent.change(code, { target: { value: 'CODE' } }); click('workspaceSyncApply.prepare')
  await screen.findByText('workspaceSyncApply.warm.historyNotDurable')
  expect(screen.queryByRole('button', { name: 'workspaceWindow.reload' })).toBeNull(); expect(mocks.applyReceived).not.toHaveBeenCalled()
})
async function pendingForm(status = 'conflict') {
  mocks.receive.mockResolvedValue({ localPending: true }); mocks.pendingStatus.mockResolvedValue({ status })
  render(<WorkspaceSyncReceiver />); const code = await codeForm()
  fireEvent.change(code, { target: { value: 'SYNTHETIC-CODE' } }); click('workspaceSyncApply.prepare')
  await screen.findByText(`workspaceSyncApply.warm.${status === 'conflict' ? 'conflict' : 'pending'}`)
}
it('pending inspection never sends; preparation requires consent and sending is a separate action', async () => {
  await pendingForm()
  expect(mocks.pendingStatus).toHaveBeenCalledOnce(); expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.prepareApply).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'workspaceSyncApply.reconcile' })).toBeDisabled()
  expect(screen.queryByDisplayValue('SYNTHETIC-CODE')).toBeNull()
  fireEvent.click(screen.getByLabelText('workspaceSyncApply.reconcileConsent'))
  const wait = deferred(); mocks.reconcilePending.mockImplementation(async () => { await wait.promise; return { conflicts: 1 } })
  const button = screen.getByRole('button', { name: 'workspaceSyncApply.reconcile' })
  act(() => { fireEvent.click(button); fireEvent.click(button) }); expect(mocks.reconcilePending).toHaveBeenCalledOnce()
  await act(async () => { wait.resolve() }); await screen.findByText('workspaceSyncApply.reconciledSummary')
  expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.applyReceived).not.toHaveBeenCalled()
  mocks.resume.mockResolvedValue({ status: 'acknowledged' }); click('workspaceSyncApply.sendPending')
  await screen.findByText('workspaceSyncApply.warm.published'); expect(mocks.resume).toHaveBeenCalledOnce()
  expect(mocks.receive).toHaveBeenCalledOnce(); expect(mocks.prepareApply).not.toHaveBeenCalled()
})
it.each(['unknown', 'reserved', 'uploaded'])('%s pending remains unsent until the explicit send button', async status => {
  await pendingForm(status)
  expect(mocks.reconcilePending).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled()
  mocks.resume.mockResolvedValue({ status: 'conflict' }); click('workspaceSyncApply.sendPending')
  await screen.findByText('workspaceSyncApply.warm.receiveAgain')
  expect(mocks.receive).toHaveBeenCalledOnce(); expect(mocks.reconcilePending).not.toHaveBeenCalled()
  mocks.pendingStatus.mockResolvedValue({ status: 'conflict' }); click('workspaceSyncApply.receiveAgain')
  await screen.findByText('workspaceSyncApply.warm.conflict'); expect(mocks.receive).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'workspaceSyncApply.reconcile' })).toBeDisabled()
})
it('a published pending is acknowledged by the explicit action, never offered conflict replacement', async () => {
  await pendingForm('published')
  expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.reconcilePending).not.toHaveBeenCalled()
  mocks.resume.mockResolvedValue({ status: 'acknowledged' }); click('workspaceSyncApply.sendPending')
  await screen.findByText('workspaceSyncApply.warm.published')
  expect(mocks.resume).toHaveBeenCalledOnce(); expect(mocks.receive).toHaveBeenCalledOnce(); expect(mocks.reconcilePending).not.toHaveBeenCalled()
})
it('uncertain local replacement offers reload only, and invalidation drops a late replacement report', async () => {
  await pendingForm(); fireEvent.click(screen.getByLabelText('workspaceSyncApply.reconcileConsent'))
  const pending = deferred(); mocks.reconcilePending.mockImplementation(async () => { await pending.promise; return { conflicts: 1 } })
  click('workspaceSyncApply.reconcile'); act(() => invalidateLocalDataViews())
  await act(async () => { pending.resolve() }); await screen.findByText('workspaceSyncApply.warm.failed')
  expect(screen.queryByRole('button', { name: 'workspaceSyncApply.sendPending' })).toBeNull()
  expect(screen.getByRole('button', { name: 'workspaceWindow.reload' })).toBeInTheDocument(); expect(mocks.resume).not.toHaveBeenCalled()
})
it('replacement failure does not offer a second attempt with an uncertain pair', async () => {
  await pendingForm(); mocks.reconcilePending.mockRejectedValue(new Error('lost local acknowledgement'))
  fireEvent.click(screen.getByLabelText('workspaceSyncApply.reconcileConsent')); click('workspaceSyncApply.reconcile')
  await screen.findByText('workspaceSyncApply.warm.failed')
  expect(screen.queryByRole('button', { name: 'workspaceSyncApply.reconcile' })).toBeNull(); expect(mocks.resume).not.toHaveBeenCalled()
})
it.each(['abort', 'erase'])('cold %s has a separate confirmation and one terminal action', async action => {
  render(<ColdSyncApplyRecovery />); click(`workspaceSyncApply.${action}`)
  expect(mocks.cold).not.toHaveBeenCalled(); click('common.cancel'); expect(mocks.cold).not.toHaveBeenCalled()
  click(`workspaceSyncApply.${action}`); const confirm = screen.getByRole('button', { name: 'workspaceSyncApply.confirm' })
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm) })
  await screen.findByText(`workspaceSyncApply.cold.${action === 'erase' ? 'erasureReserved' : 'done'}`)
  expect(mocks.cold).toHaveBeenCalledOnce(); expect(action === 'erase' ? mocks.eraseLocal : mocks.abort).toHaveBeenCalledOnce()
})
