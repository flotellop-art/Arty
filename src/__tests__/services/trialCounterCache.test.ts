import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActiveSession } from '../../services/userSession'
import { adoptPendingTrialRemaining, clearTrialRemaining, getTrialRemaining, setTrialRemaining } from '../../services/trialClient'
import * as scoped from '../../services/scopedStorage'

let serial = 0, owner = ''
function activate(id: string) { setActiveSession({ userId: id, authMethod: 'google', displayName: 'Synthetic', createdAt: 1 }) }
beforeEach(() => { localStorage.clear(); owner = `counter-cache-${++serial}`; activate(owner) })
afterEach(() => vi.restoreAllMocks())

describe('isolated UI port: optional counter failure cache, unchanged pre-login transport', () => {
  it('failed zero/removal remains closed for A without changing B, and a new successful write supersedes RAM', () => {
    setTrialRemaining(30)
    const failed = vi.spyOn(scoped, 'setItem').mockImplementation(() => { throw new Error('synthetic quota') })
    setTrialRemaining(0); expect(getTrialRemaining()).toBe(0)
    expect(localStorage.getItem(`arty-${owner}-trial-remaining`)).toBe('30')
    failed.mockRestore(); activate(`${owner}-B`); setTrialRemaining(17)
    expect(getTrialRemaining()).toBe(17)
    activate(owner); expect(getTrialRemaining()).toBe(0)
    setTrialRemaining(1); expect(getTrialRemaining()).toBe(1)
    const removal = vi.spyOn(scoped, 'removeItem').mockImplementation(() => { throw new Error('synthetic storage') })
    clearTrialRemaining(); expect(getTrialRemaining()).toBeNull()
    removal.mockRestore(); setTrialRemaining(2); expect(getTrialRemaining()).toBe(2)
  })
  it('successful existing adoption supersedes a prior failed-write override', () => {
    setTrialRemaining(30)
    const failed = vi.spyOn(scoped, 'setItem').mockImplementation(() => { throw new Error('synthetic quota') })
    setTrialRemaining(0); failed.mockRestore()
    localStorage.setItem('arty-trial-remaining', '17')
    adoptPendingTrialRemaining()
    expect(getTrialRemaining()).toBe(17); expect(localStorage.getItem('arty-trial-remaining')).toBeNull()
  })
  it('failed existing adoption still rejects and retains its pending transport instead of silently granting', () => {
    setTrialRemaining(30)
    vi.spyOn(scoped, 'setItem').mockImplementation(() => { throw new Error('synthetic quota') })
    setTrialRemaining(0); localStorage.setItem('arty-trial-remaining', '17')
    expect(() => adoptPendingTrialRemaining()).toThrow('synthetic quota')
    expect(getTrialRemaining()).toBe(0); expect(localStorage.getItem('arty-trial-remaining')).toBe('17')
  })
  it('adoption without a pending transport leaves the failed-write override unchanged', () => {
    setTrialRemaining(30)
    const failed = vi.spyOn(scoped, 'setItem').mockImplementation(() => { throw new Error('synthetic quota') })
    setTrialRemaining(0); failed.mockRestore()
    adoptPendingTrialRemaining(); expect(getTrialRemaining()).toBe(0)
  })
  it('a successful scoped adoption supersedes RAM even if the old pending removal still fails', () => {
    setTrialRemaining(30)
    const failed = vi.spyOn(scoped, 'setItem').mockImplementation(() => { throw new Error('synthetic quota') })
    setTrialRemaining(0); failed.mockRestore(); localStorage.setItem('arty-trial-remaining', '17')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('synthetic removal') })
    expect(() => adoptPendingTrialRemaining()).toThrow('synthetic removal')
    expect(getTrialRemaining()).toBe(17); expect(localStorage.getItem('arty-trial-remaining')).toBe('17')
  })
})
