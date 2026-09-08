import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/paidFeatures', () => ({ hasPaidServerFeatures: () => true }))
const mocks = vi.hoisted(() => ({ facts: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), mutate: vi.fn() }))
vi.mock('../../services/localMemoryService', () => ({ getAll: mocks.facts, addFact: mocks.add,
  updateFact: mocks.update, deleteFact: mocks.remove, MAX_FACTS: 80,
  bootstrapLocalMemory: async () => {}, mutateLocalMemory: mocks.mutate, createLocalMemoryFact: vi.fn() }))
vi.mock('../../services/scopedStorage', () => ({ getItem: () => null, getJSON: () => ({}), setJSON: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ captureGoogleGrant: () => ({isCurrent:()=>true,getAccessToken:async()=> 'synthetic-token'}), onGoogleGrantInvalidated:()=>()=>{} }))
vi.mock('../../services/trialClient', () => ({ getTrialRemaining: () => null }))
vi.mock('../../services/conversationWork', () => ({ beginConversationWork: () => () => undefined }))
vi.mock('../../services/projects/store', () => ({ captureLocalReadScope: () => ({ assertCurrent() {}, async validateReadOnly() {} }) }))
vi.mock('../../services/toast', () => ({ toast: vi.fn() }))
import { maybeExtractMemory, buildTranscript } from '../../services/autoMemory'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('bounded memory transport without editing local facts', () => {
  it('keeps the former server transcript prefix without constructing the full transcript', () => {
    const messages = Array.from({ length: 100 }, (_, i) => `${i}:` + '😀'.repeat(500))
    expect(buildTranscript(messages)).toBe(messages.map(m => '- ' + m.slice(0, 800)).join('\n').slice(0, 6000))
  })
  it('stops visiting messages as soon as the prefix is full', () => {
    const messages = Array.from({ length: 9 }, () => 'a'.repeat(800))
    Object.defineProperty(messages, 8, { get() { throw new Error('Visited message after transcript cap') } })
    expect(buildTranscript(messages).length).toBe(6000)
  })
  it('projects a long legitimate conversation and manual facts without mutating storage', async () => {
    const facts = Object.freeze(Array.from({ length: 80 }, (_, i) => Object.freeze({
      id: `lm-${i}`, content: ('😀\u0000中文' + 'a'.repeat(199)).repeat(200), createdAt: i,
    })))
    mocks.facts.mockReturnValue(facts)
    const userText = '中文😀'.repeat(2000)
    const messages = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), role: 'user', content: userText }))
    let sent: { transcript: string; facts: { id: string; content: string }[] } | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(new TextEncoder().encode(String(init.body)).length).toBeLessThanOrEqual(262144)
      sent = JSON.parse(String(init.body)); return Response.json({ add: [], replace: [] })
    }))
    await maybeExtractMemory({ id: 'synthetic-conv', messages } as never)
    expect(fetch).toHaveBeenCalledTimes(1); expect(sent).toBeDefined()
    expect(sent!.transcript).toBe(messages.map(m => '- ' + m.content.slice(0, 800)).join('\n').slice(0, 6000))
    expect(sent!.facts).toEqual(facts.map(f => ({ id: f.id, content: f.content.slice(0, 200) })))
    expect(facts[0].content.length).toBeGreaterThan(200)
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
  it('ignores invalid IDs without shortening them and caps only the transmitted list', async () => {
    const facts = Object.freeze([{ id: 'lm-' + 'z'.repeat(62), content: 'must not be shortened' },
      ...Array.from({ length: 81 }, (_, i) => ({ id: `lm-${i}`, content: 'kept' }))].map(Object.freeze))
    mocks.facts.mockReturnValue(facts)
    let sent: { facts: { id: string }[] } | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      sent = JSON.parse(String(init.body)); return Response.json({ add: [], replace: [] })
    }))
    await maybeExtractMemory({ id: 'synthetic-conv', messages: Array.from({ length: 3 }, () => ({ role: 'user', content: 'a'.repeat(200) })) } as never)
    expect(sent!.facts.map(f => f.id)).toEqual(Array.from({ length: 80 }, (_, i) => `lm-${i}`))
    expect(facts).toHaveLength(82); expect(facts[0].id).toHaveLength(65)
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
})
