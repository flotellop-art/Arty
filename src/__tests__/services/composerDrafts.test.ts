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
})
