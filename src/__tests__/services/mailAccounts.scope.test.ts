import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ owner: 'a', epoch: 1, list: vi.fn(), read: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => state.owner, getActiveSessionEpoch: () => state.epoch }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' }, registerPlugin: () => ({ listAccounts: state.list, readMessage: state.read }) }))
import { refreshMailAccounts, resetMailAccountsCache, getCachedMailAccounts, hasConnectedMailAccounts } from '../../services/mailAccounts'
import { readMailMessage } from '../../services/native/mailImap'
const b = [{ id: 'b', provider: 'imap', label: 'B', email: 'b@example.test', host: 'example.test' }]
beforeEach(() => { state.owner = 'a'; state.epoch++; state.list.mockReset(); state.read.mockReset(); resetMailAccountsCache() })
it.each(['success', 'failure'])('late A %s cannot replace B mail metadata or emit an update', async outcome => {
  let resolve!: (value: unknown) => void, reject!: (value: unknown) => void
  state.list.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no })).mockResolvedValueOnce({ accounts: b })
  const old = refreshMailAccounts()
  await vi.waitFor(() => expect(state.list).toHaveBeenCalledTimes(1))
  state.owner = 'b'; state.epoch++; resetMailAccountsCache()
  expect(await refreshMailAccounts()).toEqual(b)
  const dispatch = vi.spyOn(window, 'dispatchEvent')
  if (outcome === 'success') resolve({ accounts: [{ ...b[0], id: 'a', email: 'a@example.test' }] })
  else reject(new Error('late A error'))
  expect(await old).toEqual([]); expect(getCachedMailAccounts()).toEqual(b); expect(dispatch).not.toHaveBeenCalled(); dispatch.mockRestore()
})
it('even without cache reset, a switched session cannot synchronously read the former account', async () => {
  state.list.mockResolvedValue({ accounts: b }); await refreshMailAccounts(); expect(hasConnectedMailAccounts()).toBe(true)
  state.epoch++; expect(getCachedMailAccounts()).toEqual([]); expect(hasConnectedMailAccounts()).toBe(false)
})
it('native message body arriving after A→B→A is cancelled', async () => {
  let resolve!: (value: unknown) => void
  state.read.mockReturnValue(new Promise(yes => { resolve = yes }))
  const pending = readMailMessage('synthetic', 1), rejected = expect(pending).rejects.toThrow('mail_action_cancelled')
  await vi.waitFor(() => expect(state.read).toHaveBeenCalledOnce())
  state.owner = 'b'; state.epoch++; state.owner = 'a'; state.epoch++
  resolve({ body: 'must not reach caller' }); await rejected
})
