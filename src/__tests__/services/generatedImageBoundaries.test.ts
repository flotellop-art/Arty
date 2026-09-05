import { beforeEach, describe, expect, it, vi } from 'vitest'
const files = vi.hoisted(() => ({ deleteOwnedFiles: vi.fn(async () => 0) }))
vi.mock('../../services/secureFileStorage', () => files)
import * as storage from '../../services/storage'
import { setActiveSession } from '../../services/userSession'
import { buildConversationJsonExport, buildConversationMarkdown, buildConversationHtml, importConversationFromFile } from '../../services/conversationExport'
import { buildSharePayload, shareConsentKey } from '../../services/shareClient'
import { snapshotForExport } from '../../services/officeExport/session'
import { parseOfficeExport } from '../../services/officeExport/parse'
import type { Conversation } from '../../types'
import { buildReportPayload } from '../../services/reportClient'

const id1 = '123e4567-e89b-12d3-a456-426614174000', id2 = '123e4567-e89b-12d3-a456-426614174001'
function conversation(id = 'c1'): Conversation {
  return { id, title: 'Synthetic', messages: [{ id: 'a1', role: 'assistant', content: 'Voici les images', generatedImages: [id1, id2], timestamp: 1 }], createdAt: 1, updatedAt: 1 }
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); storage.resetConversationMemCache()
  setActiveSession({ userId: 'a', authMethod: 'demo', displayName: 'Synthetic', createdAt: 1 })
  localStorage.setItem('arty-conv-encryption-disabled', '1')
})
describe('gallery authority and honest text-only boundaries', () => {
  it('omits private IDs from public share, JSON, Markdown and PDF text, with count', () => {
    const conv = conversation()
    const outputs = [JSON.stringify(buildSharePayload(conv)), JSON.stringify(buildConversationJsonExport(conv)), buildConversationMarkdown(conv), buildConversationHtml(conv)]
    for (const output of outputs) {
      expect(output).not.toContain(id1); expect(output).not.toContain(id2)
      expect(output).not.toContain('generatedImages')
      expect(output).toMatch(/2 image\(s\)|2 message image\(s\)/)
    }
  })
  it('includes count changes in the public consent key', () => {
    const conv = conversation(), key = shareConsentKey(conv)
    conv.messages[0]!.generatedImages = [id1]
    expect(shareConsentKey(conv)).not.toBe(key)
  })
  it('allows an image-only content report without transmitting an ID or binary', () => {
    const conv = conversation(); conv.messages[0]!.content = ''
    const report = buildReportPayload(conv, conv.messages[0]!, 'offensive', 'Synthetic report')
    expect(report.messageExcerpt).toMatch(/2 image\(s\)|2 message image\(s\)/)
    expect(JSON.stringify(report)).not.toContain(id1)
  })
  it('counts the gallery and Markdown images in Office omissions without file reads', () => {
    const conv = conversation(); conv.messages[0]!.content += '\n\n![remote](https://example.com/a.png)'
    const snapshot = snapshotForExport(conv), output = parseOfficeExport(snapshot)
    expect(output.omissions.images).toBe(3)
    expect(JSON.stringify(snapshot)).not.toContain(id1)
    expect(JSON.stringify(output)).not.toContain(id2)
  })
  it('strips foreign gallery IDs on ordinary JSON import, preserving an omission notice', async () => {
    const body = JSON.stringify({ version: 1, conversation: conversation() })
    const file = { size: body.length, text: async () => body } as File
    const importedId = await importConversationFromFile(file)
    const imported = storage.getConversation(importedId)!
    expect(imported.messages[0]).not.toHaveProperty('generatedImages')
    expect(JSON.stringify(imported)).not.toContain(id1)
    expect(imported.messages[0]!.content).toMatch(/2 image\(s\)|2 message image\(s\)/)
  })
  it('keeps files shared by two branches; last branch deletion removes only structured IDs', () => {
    storage.saveConversation(conversation('original')); storage.saveConversation(conversation('branch'))
    storage.deleteConversation('original')
    expect([...files.deleteOwnedFiles.mock.calls[0]![0] as Set<string>]).toEqual([])
    storage.deleteConversation('branch')
    expect([...files.deleteOwnedFiles.mock.calls[1]![0] as Set<string>]).toEqual([id1, id2])
    expect(files.deleteOwnedFiles.mock.calls[1]![1]).toBe('a')
  })
  it('legacy Markdown can retain but never select a file for deletion', () => {
    const legacy = conversation('legacy')
    legacy.messages[0]!.generatedImages = undefined
    legacy.messages[0]!.content = `![legacy](arty-img://${id1})`
    storage.saveConversation(legacy); storage.saveConversation(conversation('new'))
    storage.deleteConversation('new')
    expect([...files.deleteOwnedFiles.mock.calls[0]![0] as Set<string>]).toEqual([id2])
    storage.deleteConversation('legacy')
    expect([...files.deleteOwnedFiles.mock.calls[1]![0] as Set<string>]).toEqual([])
  })
  it('normalizes a recovered image-only placeholder on cold read without mutating its source', () => {
    const conv = conversation(); conv.messages[0]!.id = 'streaming'; conv.messages[0]!.content = ''
    const source = structuredClone(conv)
    localStorage.setItem('arty-a-conversations', JSON.stringify([conv]))
    const recovered = storage.getConversation('c1')!
    expect(recovered.messages[0]).toMatchObject({ content: '', generatedImages: [id1, id2], interrupted: true })
    expect(recovered.messages[0]!.id).not.toBe('streaming')
    expect(conv).toEqual(source)
  })
})
