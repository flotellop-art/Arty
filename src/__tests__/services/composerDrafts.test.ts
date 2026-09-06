import { beforeEach, describe, expect, it, vi } from 'vitest'

// Contrôle du scope utilisateur sans monter toute la session.
const getActiveUserId = vi.fn<[], string | null>(() => 'user-a')
vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => getActiveUserId(),
}))

import {
  clearComposerDraft,
  clearConversationComposerDraft,
  composerDraftStorageKey,
  getComposerDraft,
  hasComposerDraft,
  purgeComposerDraftsForActiveUser,
  scopeComposerDraftKey,
  setComposerDraftMemory,
} from '../../services/composerDrafts'
import { parseComposerDraftOwnership, parseOwnedLocalKey } from '../../services/workspaceWriter/localOwnership'

describe('composerDrafts — brouillons du composeur', () => {
  beforeEach(() => {
    localStorage.clear()
    getActiveUserId.mockReturnValue('user-a')
    // Vide le cache mémoire entre les tests (module partagé).
    purgeComposerDraftsForActiveUser()
    getActiveUserId.mockReturnValue('user-b')
    purgeComposerDraftsForActiveUser()
    getActiveUserId.mockReturnValue('user-a')
  })

  it('scope les clés par utilisateur (jamais de restauration croisée)', () => {
    expect(scopeComposerDraftKey('home')).toBe('user-a:home')
    getActiveUserId.mockReturnValue(null)
    expect(scopeComposerDraftKey('home')).toBe('anonymous:home')
  })

  it('clearComposerDraft efface mémoire ET localStorage', () => {
    const key = scopeComposerDraftKey('home')
    setComposerDraftMemory(key, 'brouillon')
    localStorage.setItem(composerDraftStorageKey(key), 'ciphertext')

    clearComposerDraft(key)

    expect(hasComposerDraft(key)).toBe(false)
    expect(localStorage.getItem(composerDraftStorageKey(key))).toBeNull()
  })

  it('GC à la suppression de conversation : le brouillon associé disparaît', () => {
    const key = scopeComposerDraftKey('conversation:conv-1')
    setComposerDraftMemory(key, 'texte en cours')
    localStorage.setItem(composerDraftStorageKey(key), 'ciphertext')

    clearConversationComposerDraft('conv-1')

    expect(getComposerDraft(key)).toBeUndefined()
    expect(localStorage.getItem(composerDraftStorageKey(key))).toBeNull()
  })

  it('purge au logout : ne touche que les brouillons du user actif', () => {
    const mine = scopeComposerDraftKey('conversation:conv-1')
    setComposerDraftMemory(mine, 'mon brouillon')
    localStorage.setItem(composerDraftStorageKey(mine), 'cipher-mine')
    // Brouillon d'un AUTRE compte du même appareil — doit survivre.
    localStorage.setItem('arty-composer-draft:user-b:home', 'cipher-other')

    purgeComposerDraftsForActiveUser()

    expect(hasComposerDraft(mine)).toBe(false)
    expect(localStorage.getItem(composerDraftStorageKey(mine))).toBeNull()
    expect(localStorage.getItem('arty-composer-draft:user-b:home')).toBe('cipher-other')
  })

  it('resolves exact colon/hyphen neighbours and retains ambiguous or unknown keys in both caches', () => {
    const own = ['a:home', 'a:conversation:conv-1', 'a:conversation:11111111-1111-1111-1111-111111111111']
    const others = ['a:b:home', 'a-b:conversation:conv-1', 'élève:東京:home', 'anonymous:home', 'a:conversation:home', 'a:conversation:nested:home', 'a:conversation:id:other', 'a:unknown']
    for (const key of [...own, ...others]) { setComposerDraftMemory(key, key); localStorage.setItem(composerDraftStorageKey(key), key) }
    getActiveUserId.mockReturnValue('a'); purgeComposerDraftsForActiveUser()
    for (const key of own) { expect(hasComposerDraft(key)).toBe(false); expect(localStorage.getItem(composerDraftStorageKey(key))).toBeNull() }
    for (const key of others) { expect(getComposerDraft(key)).toBe(key); expect(localStorage.getItem(composerDraftStorageKey(key))).toBe(key) }
    getActiveUserId.mockReturnValue(null); purgeComposerDraftsForActiveUser()
    getActiveUserId.mockReturnValue('anonymous'); purgeComposerDraftsForActiveUser()
    expect(getComposerDraft('anonymous:home')).toBe('anonymous:home')
    for (const key of others) clearComposerDraft(key)
  })

  it('never widens the strict cold grammar to the logout legacy subset', () => {
    expect(parseComposerDraftOwnership('a:b:conversation:conv-1', 'logout')).toEqual({ owner: 'a:b', slot: 'conversation:conv-1' })
    expect(parseComposerDraftOwnership('a:b:conversation:conv-1', 'strict')).toBeNull()
    expect(() => parseOwnedLocalKey('arty-composer-draft:a:b:conversation:conv-1')).toThrow()
    for (const tail of ['a:conversation:home', 'anonymous:home', 'a:conversation:with:colon', ':home']) {
      expect(parseComposerDraftOwnership(tail, 'logout')).toBeNull()
    }
  })
})
