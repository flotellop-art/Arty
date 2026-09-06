import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/workspaceLocks'

// Exercise real document admission and revocation, not the global admitted fixture.
vi.unmock('../../services/workspaceWriter/runtime')
const bridge = vi.hoisted(() => ({ listAccounts: vi.fn(), removeAccount: vi.fn(), readMessage: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: (name: string) => name === 'MailImap' },
  registerPlugin: (name: string) => name === 'MailImap' ? bridge : {},
}))
let runtime: typeof import('../../services/workspaceWriter/runtime')
let users: typeof import('../../services/userSession')
let request: ReturnType<typeof deferred>
beforeEach(async () => {
  vi.restoreAllMocks(); vi.resetModules(); localStorage.clear(); globalThis.indexedDB = new IDBFactory()
  request = deferred()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request(_name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) { void callback({}); return request.promise },
  } })
  runtime = await import('../../services/workspaceWriter/runtime')
  await runtime.documentWorkspace.acquire(); expect(await runtime.workspaceAdmission.admit()).toBe('ready')
  users = await import('../../services/userSession')
  users.setActiveSession({ userId: 'synthetic-a', authMethod: 'apikey', displayName: 'Synthetic', createdAt: 1 })
  await (await import('../../services/crypto')).initCrypto('synthetic-document-key')
  for (const call of Object.values(bridge)) call.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected HTTP') }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it.each(['retire', 'lock-loss'])('Connections retires on actual %s and retained callbacks do no private reading', async cause => {
  const { useConnectionsStatus } = await import('../../hooks/useConnectionsStatus')
  const view = renderHook(() => useConnectionsStatus())
  await waitFor(() => expect(view.result.current.state).toBe('ready'))
  const old = view.result.current, action = vi.fn()
  await act(async () => {
    if (cause === 'retire') runtime.documentWorkspace.retire()
    else request.reject(new Error('synthetic exceptional lock loss'))
    await waitFor(() => expect(runtime.documentWorkspaceSignal.aborted).toBe(true))
  })
  expect(users.getActiveUserId).toThrow('workspace_document_unavailable')
  const reading = vi.spyOn(Storage.prototype, 'getItem'), opening = vi.spyOn(indexedDB, 'open')
  await act(async () => { window.dispatchEvent(new Event('focus')); old.act(action); await old.refresh() })
  expect(view.result.current.snapshot).toBeNull(); expect(view.result.current.state).toBe('unavailable')
  expect(reading).not.toHaveBeenCalled(); expect(opening).not.toHaveBeenCalled()
  expect(action).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(bridge.listAccounts).not.toHaveBeenCalled()
})

it.each(['list', 'remove', 'read'] as const)('checks real document authority after capture before native %s dispatch', async operation => {
  const mail = await import('../../services/native/mailImap')
  const pending = operation === 'list' ? mail.listMailAccounts() : operation === 'remove' ? mail.removeMailAccount('synthetic') : mail.readMailMessage('synthetic', 1)
  // captureMail has returned its admitted ticket; invoke's await continuation has not run.
  runtime.documentWorkspace.retire()
  await expect(pending).rejects.toThrow('workspace_document_unavailable')
  for (const call of Object.values(bridge)) expect(call).not.toHaveBeenCalled()
})

it.each(['success', 'failure'])('settles pending inventory %s quietly after actual document loss', async outcome => {
  const held = deferred<{ accounts: [] }>(); bridge.listAccounts.mockReturnValue(held.promise)
  const mail = await import('../../services/mailAccounts'), pending = mail.refreshMailAccounts()
  await waitFor(() => expect(bridge.listAccounts).toHaveBeenCalledOnce())
  runtime.documentWorkspace.retire()
  const reading = vi.spyOn(Storage.prototype, 'getItem'), notify = vi.spyOn(window, 'dispatchEvent')
  if (outcome === 'success') held.resolve({ accounts: [] })
  else held.reject(new Error('late synthetic failure'))
  await expect(pending).resolves.toEqual([])
  expect(reading).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled()
  expect(bridge.listAccounts).toHaveBeenCalledOnce()
})
