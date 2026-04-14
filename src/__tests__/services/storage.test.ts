import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => 'user-test',
}))

import * as storage from '../../services/storage'
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
})
