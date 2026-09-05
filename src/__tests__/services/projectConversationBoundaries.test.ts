import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const mock = vi.hoisted(() => ({ token: vi.fn(), owner: vi.fn(), epoch: vi.fn(), save: vi.fn(), ready: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mock.token }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: mock.owner, getActiveSessionEpoch: mock.epoch }))
vi.mock('../../services/storage', () => ({ saveConversation: mock.save, isCacheReady: mock.ready, getConversations: () => [] }))
import { buildSharePayload, createShare } from '../../services/shareClient'
import { importConversationFromFile } from '../../services/conversationExport'
import { hasProjectHistory, isProjectEU } from '../../services/projects/chatPolicy'

let conv: Conversation
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks(); mock.owner.mockReturnValue('a'); mock.epoch.mockReturnValue(1); mock.ready.mockReturnValue(true)
  mock.token.mockResolvedValue('normal-test-token')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'shared' }), { status: 200 })))
  conv = { id: 'old', title: 'Projet', projectId: 'foreign-project', hasProjectContext: true, euOnly: false, createdAt: 1, updatedAt: 1,
    messages: [{ id: 'm', role: 'assistant', content: 'Texte [S1]', timestamp: 1, projectTurn: { version: 1, euOnly: false, mode: 'search', partial: false,
      sources: [{ projectId: 'p', projectRevision: 1, documentId: 'doc', documentRevision: 1, sourceHash: 'a'.repeat(64), extractorVersion: 'arty-project-text-v1', name: 'secret.txt', format: 'txt', startLine: 1, endLine: 2, partial: false }] } }] }
})
afterEach(() => vi.unstubAllGlobals())
describe('project history crossing account/import/public boundaries', () => {
  it('public payload keeps the approved text, never private source names/hashes or associations', async () => {
    const result = await createShare(conv)
    expect(result.ok).toBe(true)
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]?.[1]?.body as string)
    expect(body.messages[0].content).toBe('Texte [S1]')
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/secret.txt|foreign-project|sourceHash|projectTurn/)
  })
  it.each(['switch', 'aba', 'content', 'association'] as const)('refuses %s during async auth before public POST', async change => {
    const token = deferred<string>(); mock.token.mockReturnValue(token.promise)
    const pending = createShare(conv)
    if (change === 'switch') mock.owner.mockReturnValue('b')
    if (change === 'aba') mock.epoch.mockReturnValue(3)
    if (change === 'content') conv.messages[0]!.content = 'Pas approuvé'
    if (change === 'association') conv.projectId = 'other-project'
    token.resolve('normal-test-token')
    expect((await pending).ok).toBe(false); expect(fetch).not.toHaveBeenCalled()
  })
  it('honours EU provenance even if the conversation flag is absent', async () => {
    delete conv.euOnly; conv.messages[0]!.projectTurn!.euOnly = true
    expect(isProjectEU(conv)).toBe(true); expect(buildSharePayload(conv).euOnly).toBe(true)
    expect(await createShare(conv)).toMatchObject({ ok: false, code: 'eu_blocked' }); expect(mock.token).not.toHaveBeenCalled()
  })
  it('imports restrictive history but removes foreign library and file access references', async () => {
    delete conv.hasProjectContext; delete conv.euOnly
    conv.messages[0]!.projectTurn!.euOnly = true
    conv.messages[0]!.files = [{ id: 'LOCAL-SECRET-ID', name: 'source.txt', type: 'text/plain' }]
    await importConversationFromFile({ size: 200, text: async () => JSON.stringify({ conversation: conv, version: 1 }) } as File)
    const imported = mock.save.mock.calls[0]![0] as Conversation
    expect(imported.projectId).toBeUndefined(); expect(imported.messages[0]?.projectTurn).toBeUndefined()
    expect(imported.messages[0]?.files?.[0]?.id).not.toBe('LOCAL-SECRET-ID')
    expect(hasProjectHistory(imported)).toBe(true); expect(imported.euOnly).toBe(true)
  })
  it.each(['switch', 'aba', 'locked'] as const)('refuses %s while reading an imported file', async change => {
    const file = deferred<string>(), pending = importConversationFromFile({ size: 200, text: () => file.promise } as File)
    if (change === 'switch') mock.owner.mockReturnValue('b')
    if (change === 'aba') mock.epoch.mockReturnValue(3)
    if (change === 'locked') mock.ready.mockReturnValue(false)
    file.resolve(JSON.stringify({ conversation: conv }))
    await expect(pending).rejects.toThrow(); expect(mock.save).not.toHaveBeenCalled()
  })
  it('rejects malformed messages and oversized imports without saving', async () => {
    await expect(importConversationFromFile({ size: 100, text: async () => '{"conversation":{"messages":[null]}}' } as File)).rejects.toThrow()
    await expect(importConversationFromFile({ size: 30_000_000, text: vi.fn() } as unknown as File)).rejects.toThrow()
    expect(mock.save).not.toHaveBeenCalled()
  })
})
