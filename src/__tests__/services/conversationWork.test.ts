import { describe, expect, it, vi } from 'vitest'
const session = vi.hoisted(() => ({ owner: 'a', epoch: 1 }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => session.owner, getActiveSessionEpoch: () => session.epoch }))
import { beginConversationWork, hasConversationWork } from '../../services/conversationWork'
describe('in-document background work', () => {
  it('counts nested operations, isolates conversations and releases idempotently', () => {
    const first = beginConversationWork('a'), second = beginConversationWork('a')
    expect(hasConversationWork('a')).toBe(true); expect(hasConversationWork('b')).toBe(false)
    first(); first(); expect(hasConversationWork('a')).toBe(true)
    second(); expect(hasConversationWork('a')).toBe(false)
  })
  it('never lets an old account/epoch release clear a new job', () => {
    const old = beginConversationWork('c')
    session.owner = 'b'; session.epoch++
    expect(hasConversationWork('c')).toBe(false)
    session.owner = 'a'; session.epoch++
    const fresh = beginConversationWork('c'); old()
    expect(hasConversationWork('c')).toBe(true); fresh(); expect(hasConversationWork('c')).toBe(false)
  })
})
