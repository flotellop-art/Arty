import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  user: { userId: 'A', authMethod: 'email' }, epoch: 1, available: true,
  invalidate: () => {}, erased: false,
  plugin: { startSession: vi.fn(), endSession: vi.fn(), getStatus: vi.fn(), requestAccess: vi.fn(), revokeAccess: vi.fn(), openInbox: vi.fn() },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', isPluginAvailable: () => f.available }, registerPlugin: () => f.plugin }))
vi.mock('../../services/userSession', () => ({ getActiveSession: () => f.user, getActiveSessionEpoch: () => f.epoch }))
vi.mock('../../services/localDataInvalidation', () => ({ onLocalDataInvalidated: (fn: () => void) => { f.invalidate = fn } }))
vi.mock('../../services/projects/localErasureGuard', () => ({ captureOwnerErasureGuard: () => () => { if (f.erased) throw new Error('erased') } }))
const denied = { decision: 'declined', permission: false }
const allowed = { decision: 'allowed', permission: true }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); f.user = { userId: 'A', authMethod: 'email' }; f.epoch = 1; f.available = true; f.erased = false
  f.plugin.startSession.mockResolvedValue(denied); f.plugin.endSession.mockResolvedValue(undefined)
  f.plugin.getStatus.mockResolvedValue({ decision: 'unknown', permission: false })
  f.plugin.requestAccess.mockResolvedValue(denied); f.plugin.revokeAccess.mockResolvedValue(denied)
  f.plugin.openInbox.mockResolvedValue(undefined)
})
describe('native-only SMS control boundary', () => {
  it('does not invoke the bridge on Play/web or demo', async () => {
    const sms = await import('../../services/native/localSms')
    f.available = false; await expect(sms.getLocalSmsStatus()).rejects.toThrow('unavailable')
    f.available = true; f.user.authMethod = 'demo'; await expect(sms.getLocalSmsStatus()).rejects.toThrow('unavailable')
    expect(f.plugin.startSession).not.toHaveBeenCalled()
  })
  it('offers one consent dialog even for concurrent startup effects; never opens the inbox', async () => {
    const sms = await import('../../services/native/localSms'), pending = deferred<typeof denied>()
    f.plugin.requestAccess.mockReturnValue(pending.promise)
    const first = sms.offerLocalSmsOnStartup(), second = sms.offerLocalSmsOnStartup()
    await vi.waitFor(() => expect(f.plugin.requestAccess).toHaveBeenCalledOnce())
    pending.resolve(denied); await Promise.all([first, second])
    expect(f.plugin.startSession).toHaveBeenCalledOnce(); expect(f.plugin.openInbox).not.toHaveBeenCalled()
  })
  it('does not repeat a declined disclosure or treat an OS grant as consent', async () => {
    const sms = await import('../../services/native/localSms')
    f.plugin.getStatus.mockResolvedValue({ decision: 'declined', permission: true })
    await sms.offerLocalSmsOnStartup(); expect(f.plugin.requestAccess).not.toHaveBeenCalled()
  })
  it('cancels a pending permission on account change and rejects its late result', async () => {
    const sms = await import('../../services/native/localSms'), pending = deferred<typeof allowed>()
    f.plugin.requestAccess.mockReturnValue(pending.promise)
    const first = sms.requestLocalSmsAccess(); const cancelled = expect(first).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(f.plugin.requestAccess).toHaveBeenCalledOnce())
    const old = f.plugin.requestAccess.mock.calls[0][0].token
    f.user.userId = 'B'; f.epoch++; f.invalidate()
    await sms.getLocalSmsStatus(); pending.resolve(allowed); await cancelled
    expect(f.plugin.endSession).toHaveBeenCalledWith({ token: old })
    expect(f.plugin.startSession.mock.calls.at(-1)?.[0].token).not.toBe(old)
  })
  it('does not resurrect consent when the same account reconnects', async () => {
    const sms = await import('../../services/native/localSms')
    await sms.getLocalSmsStatus(); f.epoch++; f.invalidate(); await sms.getLocalSmsStatus()
    expect(f.plugin.startSession).toHaveBeenCalledTimes(2)
    expect(f.plugin.startSession.mock.calls[0][0]).not.toEqual(f.plugin.startSession.mock.calls[1][0])
  })
  it('erasure retires native access and fails closed', async () => {
    const sms = await import('../../services/native/localSms')
    await sms.getLocalSmsStatus(); f.erased = true; f.invalidate()
    await expect(sms.openLocalSmsInbox()).rejects.toThrow('erased')
    expect(f.plugin.openInbox).not.toHaveBeenCalled(); expect(f.plugin.endSession).toHaveBeenCalledOnce()
  })
  it('only passes an opaque ticket; no owner, messages, search or network crosses JS', async () => {
    const sms = await import('../../services/native/localSms'), network = vi.spyOn(globalThis, 'fetch')
    await sms.openLocalSmsInbox(); await sms.revokeLocalSmsAccess()
    for (const mock of [f.plugin.startSession, f.plugin.openInbox, f.plugin.revokeAccess]) {
      expect(Object.keys(mock.mock.calls[0][0])).toEqual(['token'])
    }
    expect(network).not.toHaveBeenCalled(); network.mockRestore()
  })
})
