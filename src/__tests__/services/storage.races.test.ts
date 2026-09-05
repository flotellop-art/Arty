import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/userSession', () => ({ getActiveUserId: vi.fn(() => 'a'), getActiveSessionEpoch: vi.fn(() => 1) }))
vi.mock('../../services/crypto', () => ({ encrypt: vi.fn(async (s: string) => `enc:${s}`), decrypt: vi.fn(async (s: string) => s.slice(4)), isCryptoReady: vi.fn(() => true) }))
vi.mock('../../services/secureFileStorage', () => ({ deleteOwnedFiles: vi.fn(async () => 0) }))
import * as store from '../../services/storage'
import { encrypt, decrypt, isCryptoReady } from '../../services/crypto'
import { getActiveUserId, getActiveSessionEpoch } from '../../services/userSession'
import type { Conversation } from '../../types'
const conv = (id: string): Conversation => ({ id, title: id, messages: [], createdAt: 1, updatedAt: 1 })
const key = (owner: string, suffix = '') => `arty-${owner}-conversations${suffix}`
const defer = <T>() => { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j }); return { promise, resolve, reject } }
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  vi.restoreAllMocks(); localStorage.clear()
  vi.mocked(getActiveUserId).mockReturnValue('a'); vi.mocked(getActiveSessionEpoch).mockReturnValue(1)
  vi.mocked(encrypt).mockReset().mockImplementation(async s => `enc:${s}`)
  vi.mocked(decrypt).mockReset().mockImplementation(async s => s.slice(4))
  vi.mocked(isCryptoReady).mockReturnValue(true)
  store.resetConversationMemCache()
})
afterEach(() => vi.restoreAllMocks())
describe('Conversation storage: owner, generation and recoverability', () => {
  it('late encryption A cannot replace B ciphertext or remove its newer safety net', async () => {
    const pending = defer<string>(); vi.mocked(encrypt).mockReturnValueOnce(pending.promise)
    store.saveConversation(conv('a1'))
    localStorage.setItem(key('b'), JSON.stringify([conv('b1')])); localStorage.setItem(key('b', '-enc'), 'B-CIPHER')
    vi.mocked(getActiveUserId).mockReturnValue('b'); vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    store.resetConversationMemCache(); pending.resolve('A-CIPHER'); await flush()
    expect(localStorage.getItem(key('b', '-enc'))).toBe('B-CIPHER')
    expect(localStorage.getItem(key('b'))).toContain('b1')
    expect(localStorage.getItem(key('a'))).toContain('a1')
  })
  it('out-of-order encryptions never resurrect an older snapshot after the newer plain is removed', async () => {
    const one = defer<string>(), two = defer<string>()
    vi.mocked(encrypt).mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise)
    store.saveConversation(conv('old')); store.saveConversation(conv('new'))
    two.resolve('NEW-CIPHER'); await flush(); one.resolve('OLD-CIPHER'); await flush()
    expect(localStorage.getItem(key('a', '-enc'))).toBe('NEW-CIPHER')
    expect(localStorage.getItem(key('a'))).toBeNull()
  })
  it.each(['killswitch', 'crypto-unavailable'])('%s save invalidates an older encryption too', async mode => {
    const pending = defer<string>(); vi.mocked(encrypt).mockReturnValueOnce(pending.promise)
    store.saveConversation(conv('old'))
    if (mode === 'killswitch') localStorage.setItem('arty-conv-encryption-disabled', '1')
    else vi.mocked(isCryptoReady).mockReturnValue(false)
    store.saveConversation(conv('new')); pending.resolve('OLD-CIPHER'); await flush()
    expect(localStorage.getItem(key('a'))).toContain('new')
    expect(localStorage.getItem(key('a', '-enc'))).toBeNull()
  })
  it('read/cache-ready self-check the owner even if a caller forgot reset', () => {
    store.saveConversation(conv('a1')); expect(store.isCacheReady()).toBe(true)
    vi.mocked(getActiveUserId).mockReturnValue('b')
    expect(store.isCacheReady()).toBe(false)
    expect(store.getConversations()).toEqual([])
  })
  it('same-user return with a new epoch invalidates prior encryption', async () => {
    const pending = defer<string>(); vi.mocked(encrypt).mockReturnValueOnce(pending.promise)
    store.saveConversation(conv('a1')); vi.mocked(getActiveSessionEpoch).mockReturnValue(3)
    pending.resolve('STALE'); await flush()
    expect(localStorage.getItem(key('a', '-enc'))).toBeNull()
    expect(localStorage.getItem(key('a'))).toContain('a1')
  })
  it.each(['plain', 'encrypted', 'quarantine'] as const)('%s bootstrap never publishes or quarantines under a switched owner', async mode => {
    const pending = defer<string>()
    if (mode === 'plain') { localStorage.setItem(key('a'), JSON.stringify([conv('a1')])); vi.mocked(encrypt).mockReturnValueOnce(pending.promise) }
    else { localStorage.setItem(key('a', mode === 'encrypted' ? '-enc' : '-enc-locked'), 'A-CIPHER'); vi.mocked(decrypt).mockReturnValueOnce(pending.promise) }
    const boot = store.bootstrapConversationStorage()
    vi.mocked(getActiveUserId).mockReturnValue('b'); vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    localStorage.setItem(key('b'), JSON.stringify([conv('b1')])); localStorage.setItem(key('b', '-enc'), 'B-CIPHER')
    store.resetConversationMemCache(); pending.resolve(mode === 'plain' ? 'OLD' : JSON.stringify([conv('a1')]))
    await boot
    expect(store.getConversations().map(c => c.id)).toEqual(['b1'])
    expect(localStorage.getItem(key('b', '-enc'))).toBe('B-CIPHER')
    expect(localStorage.getItem(key('b', '-enc-locked'))).toBeNull()
  })
  it('a rejected old decrypt never quarantines or removes the new owner history', async () => {
    const pending = defer<string>(); vi.mocked(decrypt).mockReturnValueOnce(pending.promise)
    localStorage.setItem(key('a', '-enc'), 'A-CIPHER'); const boot = store.bootstrapConversationStorage()
    vi.mocked(getActiveUserId).mockReturnValue('b'); vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
    localStorage.setItem(key('b', '-enc'), 'B-CIPHER'); store.resetConversationMemCache()
    pending.reject(new Error('bad key')); await boot
    expect(localStorage.getItem(key('a', '-enc'))).toBe('A-CIPHER')
    expect(localStorage.getItem(key('b', '-enc'))).toBe('B-CIPHER')
    expect(localStorage.getItem(key('b', '-enc-locked'))).toBeNull()
  })
  it('a normal save during plain bootstrap wins over bootstrap encryption', async () => {
    const pending = defer<string>(); vi.mocked(encrypt).mockReturnValueOnce(pending.promise)
    localStorage.setItem(key('a'), JSON.stringify([conv('old')]))
    const boot = store.bootstrapConversationStorage(); store.saveConversation(conv('new')); await flush()
    const fresh = localStorage.getItem(key('a', '-enc')); pending.resolve('OLD-CIPHER'); await boot
    expect(localStorage.getItem(key('a', '-enc'))).toBe(fresh)
    expect(fresh).toContain('new')
  })
  it('quarantine is retained when the merged safety-net write fails', async () => {
    localStorage.setItem(key('a', '-enc-locked'), `enc:${JSON.stringify([conv('recover')])}`)
    const realSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) {
      if (name === key('a')) throw new DOMException('Quota', 'QuotaExceededError')
      realSet.call(this, name, value)
    })
    await store.bootstrapConversationStorage()
    expect(localStorage.getItem(key('a', '-enc-locked'))).toContain('recover')
    expect(store.getConversations()).toEqual([])
  })
  it('recovery cannot undo a deletion interleaved with decryption', async () => {
    localStorage.setItem('arty-conv-encryption-disabled', '1')
    localStorage.setItem(key('a'), JSON.stringify([conv('x'), conv('y')]))
    localStorage.setItem(key('a', '-enc-locked'), 'LOCKED')
    const pending = defer<string>(); vi.mocked(decrypt).mockReturnValueOnce(pending.promise)
    const boot = store.bootstrapConversationStorage()
    store.deleteConversation('x')
    pending.resolve(JSON.stringify([conv('x')])); await boot
    expect(store.getConversations().map(c => c.id)).toEqual(['y'])
    expect(localStorage.getItem(key('a', '-enc-locked'))).toBe('LOCKED')
  })
  it('plain migration encrypts sanitized content while guarding the original safety net', async () => {
    const legacy = { ...conv('legacy'), messages: [{ id: 'm1', role: 'user', content: 'Keep me', timestamp: 1, gmailSearch: { secret: 'obsolete' } }] }
    localStorage.setItem(key('a'), JSON.stringify([legacy]))
    await store.bootstrapConversationStorage()
    expect(localStorage.getItem(key('a', '-enc'))).toContain('Keep me')
    expect(localStorage.getItem(key('a', '-enc'))).not.toContain('gmailSearch')
    expect(localStorage.getItem(key('a'))).toBeNull()
  })
  it('a delete during migration encryption also prevents starting obsolete recovery', async () => {
    localStorage.setItem(key('a'), JSON.stringify([conv('x'), conv('y')]))
    localStorage.setItem(key('a', '-enc-locked'), `enc:${JSON.stringify([conv('x')])}`)
    const pending = defer<string>(); vi.mocked(encrypt).mockReturnValueOnce(pending.promise)
    const boot = store.bootstrapConversationStorage()
    store.deleteConversation('x'); pending.resolve('OLD'); await boot
    expect(store.getConversations().map(c => c.id)).toEqual(['y'])
    expect(localStorage.getItem(key('a', '-enc-locked'))).toContain('x')
  })
  it.each(['reset', 'a-b-a'])('%s invalidates a pending encryption', async mode => {
    const pending = defer<string>(); vi.mocked(encrypt).mockReturnValueOnce(pending.promise)
    store.saveConversation(conv('old'))
    if (mode === 'reset') store.resetConversationMemCache()
    else {
      vi.mocked(getActiveUserId).mockReturnValue('b'); vi.mocked(getActiveSessionEpoch).mockReturnValue(2)
      store.getConversations()
      vi.mocked(getActiveUserId).mockReturnValue('a'); vi.mocked(getActiveSessionEpoch).mockReturnValue(3)
    }
    pending.resolve('STALE'); await flush()
    expect(localStorage.getItem(key('a', '-enc'))).toBeNull()
    expect(localStorage.getItem(key('a'))).toContain('old')
  })
  it('killswitch activated during encryption keeps its plain safety net even without another save', async () => {
    const pending = defer<string>(); vi.mocked(encrypt).mockReturnValueOnce(pending.promise)
    store.saveConversation(conv('old')); localStorage.setItem('arty-conv-encryption-disabled', '1')
    pending.resolve('STALE'); await flush()
    expect(localStorage.getItem(key('a', '-enc'))).toBeNull()
    expect(localStorage.getItem(key('a'))).toContain('old')
  })
  it('failed synchronous save does not publish an undurable cache entry', () => {
    localStorage.setItem(key('a'), JSON.stringify([conv('old')]))
    store.getConversations()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => store.saveConversation(conv('new'))).toThrow('quota')
    expect(store.getConversations().map(c => c.id)).toEqual(['old'])
  })
})
