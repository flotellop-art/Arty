import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => 'user-test',
}))

import * as storage from '../../services/storage'
import { initCrypto, encrypt } from '../../services/crypto'
import type { Conversation } from '../../types'

function makeConv(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `conv ${id}`,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Conversation
}

beforeEach(() => {
  localStorage.clear()
  // The in-memory conversation cache is module state — localStorage.clear()
  // does not reset it. Drop it so each test starts from a clean slate.
  storage.resetConversationMemCache()
})

describe('storage', () => {
  it('getConversations returns [] when nothing stored', () => {
    expect(storage.getConversations()).toEqual([])
  })

  it('saveConversation inserts a new conversation at the top', () => {
    storage.saveConversation(makeConv('a'))
    storage.saveConversation(makeConv('b'))
    const convs = storage.getConversations()
    expect(convs.map(c => c.id)).toEqual(['b', 'a'])
  })

  it('saveConversation updates existing in-place', () => {
    storage.saveConversation(makeConv('a', { title: 'first' }))
    storage.saveConversation(makeConv('a', { title: 'updated' }))
    const convs = storage.getConversations()
    expect(convs).toHaveLength(1)
    expect(convs[0]!.title).toBe('updated')
  })

  it('getConversation returns null for unknown id', () => {
    storage.saveConversation(makeConv('a'))
    expect(storage.getConversation('zzz')).toBeNull()
  })

  it('getConversation returns the matching conversation', () => {
    storage.saveConversation(makeConv('a'))
    expect(storage.getConversation('a')?.id).toBe('a')
  })

  it('deleteConversation removes the entry', () => {
    storage.saveConversation(makeConv('a'))
    storage.saveConversation(makeConv('b'))
    storage.deleteConversation('a')
    const convs = storage.getConversations()
    expect(convs.map(c => c.id)).toEqual(['b'])
  })

  it('saveConversation remains synchronous (BUG 16)', () => {
    // saveConversation must NOT return a Promise — otherwise UI stalls and
    // messages only render after a full reload (see CLAUDE.md BUG 16).
    const ret = storage.saveConversation(makeConv('a')) as unknown
    expect(ret).toBeUndefined()
  })

  it('bootstrap migrates a legacy plain conversations blob into the cache', async () => {
    // Simulate an existing (pre-encryption) install: plain JSON at rest.
    localStorage.setItem('arty-user-test-conversations', JSON.stringify([makeConv('legacy')]))
    storage.resetConversationMemCache()
    await storage.bootstrapConversationStorage()
    expect(storage.getConversations().map((c) => c.id)).toEqual(['legacy'])
  })

  it('saveConversation is skipped (no clobber) when encrypted history is not yet loaded', () => {
    // A ciphertext blob exists but bootstrap has not run — the in-memory
    // cache does not reflect the real history. saveConversation must NOT
    // persist a partial list, and must NOT wipe the blob.
    localStorage.setItem('arty-user-test-conversations-enc', 'ciphertext-blob')
    storage.resetConversationMemCache()
    storage.saveConversation(makeConv('new'))
    expect(storage.getConversations()).toEqual([])
    expect(localStorage.getItem('arty-user-test-conversations-enc')).toBe('ciphertext-blob')
  })

  it('killswitch keeps conversations as plain JSON, no ciphertext', () => {
    localStorage.setItem('arty-conv-encryption-disabled', '1')
    storage.resetConversationMemCache()
    storage.saveConversation(makeConv('a'))
    expect(localStorage.getItem('arty-user-test-conversations')).toContain('"id":"a"')
    expect(localStorage.getItem('arty-user-test-conversations-enc')).toBeNull()
  })
})

// Écran vide permanent (juillet 2026) : un blob indéchiffrable laissait
// cacheReady=false pour toute la session → chaque nouvelle conversation était
// silencieusement droppée → ChatRoute rendait `null` pour toujours. Le fix :
// quarantaine du blob (déplacé, jamais supprimé) + récupération/fusion au
// boot suivant si la clé redevient la bonne.
describe('storage — quarantine & recovery of undecryptable history', () => {
  const ENC = 'arty-user-test-conversations-enc'
  const LOCKED_1 = 'arty-user-test-conversations-enc-locked'
  const LOCKED_2 = 'arty-user-test-conversations-enc-locked-2'

  it('quarantines an undecryptable blob and unlocks the cache (app stays usable)', async () => {
    // Historique chiffré sous la clé A…
    await initCrypto('passphrase-A')
    const blobA = await encrypt(JSON.stringify([makeConv('old-1'), makeConv('old-2')]))
    localStorage.setItem(ENC, blobA)
    // …mais la session courante dérive la clé B (état "mauvaise passphrase").
    await initCrypto('passphrase-B')
    storage.resetConversationMemCache()
    await storage.bootstrapConversationStorage()

    // Blob préservé en quarantaine, jamais supprimé.
    expect(localStorage.getItem(LOCKED_1)).toBe(blobA)
    expect(localStorage.getItem(ENC)).toBeNull()
    // Cache débloqué : l'app repart sur un historique vide UTILISABLE.
    expect(storage.isCacheReady()).toBe(true)
    expect(storage.getConversations()).toEqual([])
    storage.saveConversation(makeConv('new'))
    expect(storage.getConversations().map((c) => c.id)).toEqual(['new'])
  })

  it('recovers and merges a quarantined blob once the key matches again', async () => {
    await initCrypto('passphrase-A')
    const blobA = await encrypt(JSON.stringify([makeConv('old', { updatedAt: 1 })]))
    localStorage.setItem(LOCKED_1, blobA)
    localStorage.setItem(ENC, await encrypt(JSON.stringify([makeConv('current', { updatedAt: 2 })])))
    storage.resetConversationMemCache()
    await storage.bootstrapConversationStorage()

    // Historique fusionné (le courant d'abord, le récupéré ensuite) et slot libéré.
    expect(storage.getConversations().map((c) => c.id)).toEqual(['current', 'old'])
    expect(localStorage.getItem(LOCKED_1)).toBeNull()
  })

  it('keeps writes disabled when both quarantine slots are full (never destroys)', async () => {
    await initCrypto('passphrase-A')
    const foreign = await encrypt(JSON.stringify([makeConv('x')]))
    await initCrypto('passphrase-B')
    localStorage.setItem(LOCKED_1, 'older-locked-blob')
    localStorage.setItem(LOCKED_2, 'other-locked-blob')
    localStorage.setItem(ENC, foreign)
    storage.resetConversationMemCache()
    await storage.bootstrapConversationStorage()

    // Rien n'est écrasé ni supprimé ; le comportement d'avant-fix s'applique.
    expect(localStorage.getItem(ENC)).toBe(foreign)
    expect(localStorage.getItem(LOCKED_1)).toBe('older-locked-blob')
    expect(localStorage.getItem(LOCKED_2)).toBe('other-locked-blob')
    expect(storage.isCacheReady()).toBe(false)
    storage.saveConversation(makeConv('dropped'))
    expect(localStorage.getItem(ENC)).toBe(foreign)
  })
})
