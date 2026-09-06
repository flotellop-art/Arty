import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { google, installCalendarAccount, resetCalendarFixture } from '../helpers/calendarFixture'
import { setActiveSession } from '../../services/userSession'
import { initCrypto } from '../../services/crypto'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
const sessionB = () => setActiveSession({ userId: 'b', authMethod: 'google', email: 'b@example.invalid', displayName: 'B', createdAt: 1 })
const bRecords = () => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('arty-b-google-')).sort().map(k => [k, localStorage.getItem(k)]))
beforeEach(resetCalendarFixture)
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('content-free Google revocation notification: reentrant owner isolation', () => {
  it.each(['storeUser', 'storeTokens', 'logout', 'bootstrap', 'reset', 'key-transfer'])('%s cannot write A into or erase B after an observer switches the owner', async operation => {
    await installCalendarAccount('b'); const before = bRecords(); expect(Object.keys(before).length).toBeGreaterThan(0)
    await installCalendarAccount('a')
    const stop = google.onGoogleGrantInvalidated(sessionB)
    try {
      if (operation === 'storeUser') expect(await google.storeUser({ email: 'a@example.invalid', name: 'A', picture: '' })).toBe(false)
      if (operation === 'storeTokens') expect(await google.storeTokens({ access_token: 'synthetic-A', expires_at: Date.now() + 100000 })).toBe(false)
      if (operation === 'logout') google.logout()
      if (operation === 'bootstrap') await google.bootstrapGoogleStorage()
      if (operation === 'reset') google.resetGoogleMemCache()
      if (operation === 'key-transfer') await expect(google.prepareGoogleKeyChange()).rejects.toThrow()
      expect(bRecords()).toEqual(before)
      expect(google.captureGoogleGrant()).toBeNull()
    } finally { stop() }
  })
  it.each(['reset', 'key-transfer'])('%s does not erase or supersede a reentrant same-owner writer', async operation => {
    let writing!: Promise<boolean>
    const stop = google.onGoogleGrantInvalidated(() => { writing = google.storeUser({ email: 'new@example.invalid', name: 'New', picture: '' }) })
    try {
      if (operation === 'reset') google.resetGoogleMemCache()
      else await expect(google.prepareGoogleKeyChange()).rejects.toThrow()
      expect(await writing).toBe(true); expect(google.getStoredUser()?.name).toBe('New')
    } finally { stop() }
  })
  it('does not signal a private token refresh as a grant change', async () => {
    await installCalendarAccount('a', true)
    const listener = vi.fn(), stop = google.onGoogleGrantInvalidated(listener)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ access_token: 'synthetic-refreshed', expires_in: 3600, oauth_profile: google.CURRENT_GOOGLE_OAUTH_PROFILE })))
    try { expect(await google.getValidAccessToken()).toBe('synthetic-refreshed'); expect(listener).not.toHaveBeenCalled() }
    finally { stop() }
  })
  it.each(['mailbox', 'exchange', 'userinfo', 'intent', 'grant', 'user-read', 'token-read', 'key-transfer'])('refuses %s when cache normalization itself notifies a switch', async operation => {
    // Cached A, active B, observer switches to C during ensureCacheOwner.
    sessionB()
    const before = { ...localStorage }
    const stop = google.onGoogleGrantInvalidated(() => setActiveSession({ userId: 'c', authMethod: 'google', displayName: 'C', createdAt: 1 }))
    vi.stubGlobal('fetch', vi.fn())
    try {
      if (operation === 'mailbox') await expect(google.storeMailboxFreeGrant({ access_token: 'synthetic-B', expires_at: Date.now() + 3600000 }, undefined, { verifiedEmail: 'b@example.invalid' })).rejects.toThrow('superseded')
      if (operation === 'exchange') await expect(google.exchangeCode('synthetic-B', '')).rejects.toThrow('superseded')
      if (operation === 'userinfo') await expect(google.fetchGoogleUser('synthetic-B')).rejects.toThrow('superseded')
      if (operation === 'intent') expect(google.captureGoogleAuthIntent()()).toBe(false)
      if (operation === 'grant') expect(google.captureGoogleGrant()).toBeNull()
      if (operation === 'user-read') expect(google.getStoredUser()).toBeNull()
      if (operation === 'token-read') expect(google.getStoredTokens()).toBeNull()
      if (operation === 'key-transfer') await expect(google.prepareGoogleKeyChange()).rejects.toThrow()
      expect(Object.keys(localStorage).filter(k => k.startsWith('arty-c-google-'))).toEqual([])
      for (const key of Object.keys(before).filter(k => k.startsWith('arty-a-google-'))) expect(localStorage.getItem(key)).toBe(before[key])
      expect(fetch).not.toHaveBeenCalled()
    } finally { stop() }
  })
  it.each(['storeTokens', 'storeUser', 'mailbox', 'intent', 'bootstrap', 'logout'])('%s cannot supersede a same-owner writer started during cache normalization', async operation => {
    sessionB(); await initCrypto('synthetic-B-key')
    let writing!: Promise<boolean>
    const stop = google.onGoogleGrantInvalidated(() => { writing = google.storeUser({ email: 'b@example.invalid', name: 'R2', picture: '' }) })
    try {
      if (operation === 'storeTokens') expect(await google.storeTokens({ access_token: 'R1', expires_at: Date.now() + 100000 })).toBe(false)
      if (operation === 'storeUser') expect(await google.storeUser({ email: 'b@example.invalid', name: 'R1', picture: '' })).toBe(false)
      if (operation === 'mailbox') await expect(google.storeMailboxFreeGrant({ access_token: 'R1', expires_at: Date.now() + 100000 }, undefined, { verifiedEmail: 'b@example.invalid' })).rejects.toThrow('superseded')
      if (operation === 'intent') expect(google.captureGoogleAuthIntent()()).toBe(false)
      if (operation === 'bootstrap') await google.bootstrapGoogleStorage()
      if (operation === 'logout') google.logout()
      expect(await writing).toBe(true); expect(google.getStoredUser()?.name).toBe('R2')
    } finally { stop() }
  })
})
