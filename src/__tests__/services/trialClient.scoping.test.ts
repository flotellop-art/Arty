import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let activeUserId: string | null = null
const scopedValues = new Map<string, string>()
const identity = vi.hoisted(() => ({ generate: vi.fn(async (method: string, email: string) => `${method}:${email}`) }))
vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => activeUserId, generateUserId: identity.generate,
}))
vi.mock('../../services/scopedStorage', () => ({
  getItem: (key: string) => scopedValues.get(`${activeUserId}:${key}`) ?? null,
  setItem: (key: string, value: string) => { scopedValues.set(`${activeUserId}:${key}`, value) },
  removeItem: (key: string) => { scopedValues.delete(`${activeUserId}:${key}`) },
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))

import { adoptPendingTrialRemaining, clearPendingTrialRemaining, clearOnboardingSplash,
  getTrialRemaining, initEmailTrialSplash, setTrialRemaining, getOnboardingSplash, initTrial } from '../../services/trialClient'
import * as scoped from '../../services/scopedStorage'

const A = 'google:a.b+tag@gmail.com', B = 'google:ab@gmail.com'
beforeEach(() => {
  activeUserId = null; scopedValues.clear(); clearPendingTrialRemaining(); clearOnboardingSplash()
  localStorage.clear(); identity.generate.mockClear()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function reply(plan = 'trial', remaining: unknown = 30) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ plan, trial_messages_remaining: remaining })))
}
async function googleA() { return initTrial('synthetic-google', 'a.b+tag@gmail.com') }

describe('trialClient — exact owner, optional metadata, no durable handoff', () => {
  it('503 clears only the attempted account snapshot, preserving the active neighbour', async () => {
    activeUserId = A; initEmailTrialSplash(30)
    activeUserId = B; setTrialRemaining(17)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await googleA()).toBeNull(); expect(getTrialRemaining()).toBe(17)
    activeUserId = A; adoptPendingTrialRemaining()
    expect(getTrialRemaining()).toBeNull(); expect(getOnboardingSplash()).toBeNull()
    activeUserId = B; expect(getTrialRemaining()).toBe(17)
  })
  it('an interrupted A login cannot change B quota or B welcome at bootstrap', async () => {
    activeUserId = B; initEmailTrialSplash(30)
    reply(); await googleA(); adoptPendingTrialRemaining()
    expect(getTrialRemaining()).toBe(30); expect(getOnboardingSplash()).toBe('trial')
    expect(scopedValues.has(`${A}:trial-remaining`)).toBe(false)
    activeUserId = A; adoptPendingTrialRemaining(); expect(getTrialRemaining()).toBeNull()
  })
  it('an actual module reload loses pending metadata and ignores all old global markers', async () => {
    reply(); await googleA()
    localStorage.setItem('arty-trial-remaining', '30')
    localStorage.setItem('arty-trial-onboarding-splash', 'vip')
    activeUserId = B; setTrialRemaining(17)
    vi.resetModules()
    const reloaded = await import('../../services/trialClient')
    reloaded.adoptPendingTrialRemaining()
    expect(reloaded.getTrialRemaining()).toBe(17); expect(reloaded.getOnboardingSplash()).toBeNull()
    activeUserId = A; reloaded.adoptPendingTrialRemaining(); expect(reloaded.getTrialRemaining()).toBeNull()
  })
  it.each([0, 17, 30, null, undefined, -1, 31, 1.5, '30'])('Google validates remaining %s before a welcome', async remaining => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ plan: 'trial', trial_messages_remaining: remaining })))
    await googleA(); expect(getOnboardingSplash()).toBeNull()
    activeUserId = A; adoptPendingTrialRemaining()
    const expected = typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0 && remaining <= 30 ? remaining : null
    expect(getTrialRemaining()).toBe(expected)
    expect(getOnboardingSplash()).toBe(expected === 30 ? 'trial' : null)
    expect(identity.generate).toHaveBeenCalledWith('google', 'a.b+tag@gmail.com')
    activeUserId = B; expect(getOnboardingSplash()).toBeNull(); expect(getTrialRemaining()).toBeNull()
  })
  it.each([0, 17, 30, null])('OTP restores verified %s after login instead of promising a fresh trial', remaining => {
    activeUserId = A; initEmailTrialSplash(30); initEmailTrialSplash(remaining)
    expect(getTrialRemaining()).toBe(remaining)
    expect(getOnboardingSplash()).toBe(remaining === 30 ? 'trial' : null)
    activeUserId = B; expect(getTrialRemaining()).toBeNull(); expect(getOnboardingSplash()).toBeNull()
  })
  it('does not create an ownerless OTP welcome or adopt an old unowned counter', () => {
    initEmailTrialSplash(30); expect(getOnboardingSplash()).toBeNull()
    localStorage.setItem('arty-trial-remaining', '30')
    activeUserId = A; adoptPendingTrialRemaining()
    expect(getTrialRemaining()).toBeNull(); expect(localStorage.getItem('arty-trial-remaining')).toBeNull()
  })
  it.each(['getItem', 'setItem', 'removeItem'] as const)('a localStorage %s failure never rejects login metadata or restores a readable old30', async method => {
    activeUserId = A; initEmailTrialSplash(30)
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('synthetic storage refusal') })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    await expect(googleA()).resolves.toBeNull()
    expect(() => adoptPendingTrialRemaining()).not.toThrow()
    expect(getTrialRemaining()).toBeNull(); expect(getOnboardingSplash()).toBeNull()
    expect(() => initEmailTrialSplash(null)).not.toThrow()
  })
  it('digest failure also resolves null rather than rejecting authentication', async () => {
    identity.generate.mockRejectedValueOnce(new Error('synthetic digest failure'))
    await expect(googleA()).resolves.toBeNull()
  })
  it.each(['setItem', 'removeItem'] as const)('a failed scoped %s cannot resurrect old30, and a later successful write retires the RAM exception', async method => {
    activeUserId = A; initEmailTrialSplash(30)
    const refusal = vi.spyOn(scoped, method).mockImplementation(() => { throw new Error('synthetic scoped refusal') })
    reply('trial', method === 'setItem' ? 17 : null); await googleA(); adoptPendingTrialRemaining()
    expect(scopedValues.get(`${A}:trial-remaining`)).toBe('30')
    expect(getTrialRemaining()).toBe(method === 'setItem' ? 17 : null)
    activeUserId = B; setTrialRemaining(12); expect(getTrialRemaining()).toBe(12)
    activeUserId = A; expect(getTrialRemaining()).toBe(method === 'setItem' ? 17 : null)
    refusal.mockRestore(); setTrialRemaining(16); expect(getTrialRemaining()).toBe(16)
    scopedValues.set(`${A}:trial-remaining`, '15'); expect(getTrialRemaining()).toBe(15)
  })
  it('an OTP continuation replaced by another owner cannot overwrite that owner', () => {
    activeUserId = B; initEmailTrialSplash(17)
    initEmailTrialSplash(30, A)
    expect(getTrialRemaining()).toBe(17); expect(getOnboardingSplash()).toBeNull()
  })
  it('a pending value is consumed before events and cannot replay after a message', async () => {
    reply(); await googleA(); activeUserId = A
    const listener = () => adoptPendingTrialRemaining()
    window.addEventListener('arty-trial-remaining-changed', listener)
    try { adoptPendingTrialRemaining() } finally { window.removeEventListener('arty-trial-remaining-changed', listener) }
    setTrialRemaining(29); adoptPendingTrialRemaining(); expect(getTrialRemaining()).toBe(29)
  })
  it.each(['new-login', 'cancel'] as const)('late A response cannot republish after %s', async action => {
    let finish!: (response: Response) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
      .mockImplementationOnce(async () => Response.json({ plan: 'trial', trial_messages_remaining: 17 }))
    vi.stubGlobal('fetch', fetcher)
    const old = googleA(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    if (action === 'new-login') await initTrial('synthetic-B', 'ab@gmail.com')
    else clearPendingTrialRemaining()
    finish(Response.json({ plan: 'trial', trial_messages_remaining: 30 })); await old
    activeUserId = B; adoptPendingTrialRemaining()
    expect(getTrialRemaining()).toBe(action === 'new-login' ? 17 : null)
    activeUserId = A; adoptPendingTrialRemaining(); expect(getTrialRemaining()).toBeNull()
  })
  it('a provisional session welcome is invisible to the still-published neighbour', async () => {
    reply('vip'); await googleA(); activeUserId = A; adoptPendingTrialRemaining()
    expect(getOnboardingSplash(A)).toBe('vip')
    expect(getOnboardingSplash(B)).toBeNull(); expect(getOnboardingSplash(null)).toBeNull()
  })
})
