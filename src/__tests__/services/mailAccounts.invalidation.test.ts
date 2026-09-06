import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deferred } from '../helpers/workspaceLocks'
const f = vi.hoisted(() => ({ owner: 'a', epoch: 1, list: vi.fn(), add: vi.fn(), remove: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => f.owner, getActiveSessionEpoch: () => f.epoch }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({ listAccounts: f.list, addAccount: f.add, removeAccount: f.remove }) }))
import { refreshMailAccounts, resetMailAccountsCache, getCachedMailAccounts, getMailInventoryStatus } from '../../services/mailAccounts'
import { addMailAccount, removeMailAccount } from '../../services/native/mailImap'
const account = (owner: string) => ({ id: owner, provider: 'imap', label: 'Synthetic', email: `${owner}@example.test`, host: 'example.test' })
const input = { provider: 'imap', label: 'Synthetic', host: 'example.test', email: 'a@example.test', password: 'synthetic' }
beforeEach(() => {
  vi.restoreAllMocks(); f.owner = 'a'; f.epoch++
  f.list.mockReset().mockResolvedValue({ accounts: [account('a')] }); f.add.mockReset(); f.remove.mockReset(); resetMailAccountsCache()
})
afterEach(() => { vi.restoreAllMocks() })

it.each(['add', 'remove'] as const)('invalidates a stale same-owner inventory after %s even across A→B→A', async operation => {
  await refreshMailAccounts()
  const held = deferred<{ id: string; messageCount: number }>(); f[operation].mockReturnValue(held.promise)
  const pending = (operation === 'add' ? addMailAccount(input) : removeMailAccount('a')).catch(error => error)
  await vi.waitFor(() => expect(f[operation]).toHaveBeenCalledOnce())
  f.owner = 'b'; f.epoch++; f.owner = 'a'; f.epoch++
  await refreshMailAccounts(); expect(getMailInventoryStatus()).toMatchObject({ status: 'ready', count: 1 })
  held.resolve({ id: 'committed', messageCount: 1 })
  expect((await pending).message).toBe('mail_action_cancelled')
  expect(getMailInventoryStatus()).toMatchObject({ status: 'unknown', count: 0 })
  expect(getCachedMailAccounts()).toEqual([]); expect(f.list).toHaveBeenCalledTimes(2)
})

it.each(['add', 'remove'] as const)('a late A %s does not invalidate or notify B', async operation => {
  await refreshMailAccounts()
  const held = deferred<{ id: string; messageCount: number }>(); f[operation].mockReturnValue(held.promise)
  const pending = (operation === 'add' ? addMailAccount(input) : removeMailAccount('a')).catch(error => error)
  await vi.waitFor(() => expect(f[operation]).toHaveBeenCalledOnce())
  f.owner = 'b'; f.epoch++; f.list.mockResolvedValue({ accounts: [account('b')] }); await refreshMailAccounts()
  const before = getMailInventoryStatus(), notify = vi.spyOn(window, 'dispatchEvent')
  held.resolve({ id: 'committed', messageCount: 1 }); await pending
  expect(getMailInventoryStatus()).toEqual(before); expect(getCachedMailAccounts()).toEqual([account('b')])
  expect(notify).not.toHaveBeenCalled(); expect(f.list).toHaveBeenCalledTimes(2)
})

it.each(['success', 'failure'])('invalidates an in-flight pre-mutation list on %s without reading it again', async outcome => {
  const held = deferred<{ accounts: ReturnType<typeof account>[] }>(); f.list.mockReturnValue(held.promise)
  const oldRead = refreshMailAccounts(); await vi.waitFor(() => expect(f.list).toHaveBeenCalledOnce())
  if (outcome === 'success') f.remove.mockResolvedValue({})
  else f.remove.mockRejectedValue(new Error('bridge reply lost: commit cannot be excluded'))
  await removeMailAccount('a').catch(() => {})
  const revision = getMailInventoryStatus().revision
  held.resolve({ accounts: [account('a')] }); expect(await oldRead).toEqual([])
  expect(getMailInventoryStatus()).toMatchObject({ status: 'unknown', count: 0, revision })
  expect(f.list).toHaveBeenCalledOnce()
})

it('finishes cache invalidation before a reentrant observer installs B', async () => {
  await refreshMailAccounts(); f.remove.mockResolvedValue({})
  let replacement: Promise<unknown> | undefined
  const observer = () => {
    window.removeEventListener('mail-accounts-updated', observer)
    f.owner = 'b'; f.epoch++; f.list.mockResolvedValue({ accounts: [account('b')] })
    replacement = refreshMailAccounts()
  }
  window.addEventListener('mail-accounts-updated', observer)
  try {
    await expect(removeMailAccount('a')).rejects.toThrow('mail_action_cancelled'); await replacement
    expect(getMailInventoryStatus()).toMatchObject({ status: 'ready', count: 1 })
    expect(getCachedMailAccounts()).toEqual([account('b')]); expect(f.remove).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('mail-accounts-updated', observer) }
})
