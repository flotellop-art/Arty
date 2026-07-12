import { beforeEach, describe, expect, it, vi } from 'vitest'

let activeUserId: string | null = null
const scopedValues = new Map<string, string>()

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => activeUserId,
}))
vi.mock('../../services/scopedStorage', () => ({
  getItem: (key: string) => scopedValues.get(`${activeUserId}:${key}`) ?? null,
  setItem: (key: string, value: string) => { scopedValues.set(`${activeUserId}:${key}`, value) },
  removeItem: (key: string) => { scopedValues.delete(`${activeUserId}:${key}`) },
}))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))

import {
  adoptPendingTrialRemaining,
  getTrialRemaining,
  initEmailTrialSplash,
  setTrialRemaining,
} from '../../services/trialClient'

beforeEach(() => {
  activeUserId = null
  scopedValues.clear()
  localStorage.clear()
})

describe('trialClient — compteur isolé par compte', () => {
  it('adopte le compteur pré-session puis isole deux comptes', () => {
    initEmailTrialSplash(30)
    expect(localStorage.getItem('arty-trial-remaining')).toBe('30')

    activeUserId = 'user-a'
    adoptPendingTrialRemaining()
    expect(localStorage.getItem('arty-trial-remaining')).toBeNull()
    expect(getTrialRemaining()).toBe(30)

    activeUserId = 'user-b'
    expect(getTrialRemaining()).toBeNull()
    setTrialRemaining(7)
    expect(getTrialRemaining()).toBe(7)

    activeUserId = 'user-a'
    expect(getTrialRemaining()).toBe(30)
  })
})
