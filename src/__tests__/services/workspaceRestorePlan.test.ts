import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto, randomUUID } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { prepareWorkspaceRestore, type RestoreMappingRecord } from '../../services/workspaceBackup/restorePlan'
import { openWorkspaceBackup, sealWorkspaceBackup } from '../../services/workspaceBackup/archive'
import { sha256 } from '../../services/workspaceBackup/bytes'
import { BACKUP_LIMITS, BACKUP_FEATURES } from '../../services/workspaceBackup/types'
import { code, fixture, guard, ids, emptySnapshot } from '../helpers/workspaceBackup'

const forbidden = vi.fn(() => { throw new Error('preparation must not access app storage/network') })
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob)
  forbidden.mockClear()
  vi.stubGlobal('fetch', forbidden)
  vi.stubGlobal('indexedDB', { open: forbidden, deleteDatabase: forbidden })
  for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) vi.spyOn(Storage.prototype, method).mockImplementation(forbidden)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
function factory() {
  let n = 0
  return () => `10000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`
}
async function source(version: 1 | 2 = 1) {
  const f = await fixture()
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0])])
  f.objects.set(ids.fileObj, png)
  f.snapshot.objects.find(o => o.id === ids.fileObj)!.sha256 = await sha256(new Uint8Array(await png.arrayBuffer()))
  if (version === 2) {
    for (const file of f.snapshot.files) file.recordedSize = 777 + file.size
    for (const c of f.snapshot.conversations) for (const m of c.messages) for (const ref of m.files ?? []) {
      ref.presentation = { name: ' Nom historique ', type: '', size: 0, width: 0, height: 0, normalizationVersion: 0 }
    }
  }
  return { ...f, seal: () => sealWorkspaceBackup(f.snapshot, f.objects, code, guard, version) }
}
const mapped = (r: RestoreMappingRecord, kind: string, source: string, parent?: string) => r.ids.find(e => e.kind === kind && e.source === source && e.parent === parent)!.target

describe('restore preparation — authenticated data, never publication', () => {
  it.each([1, 2] as const)('prepares v%s with exact metadata, text and objects and no account/storage/network', async version => {
    const f = await source(version), before = clone(f.snapshot), archive = await f.seal()
    const prepared = await prepareWorkspaceRestore(archive, code, guard, { idFactory: factory() })
    const p = prepared.plan, c = p.conversations[0]!.conversation, m = c.messages[1]!
    expect(p.publication).toBe('not-authorized'); expect(p.messagePolicy).toBe('historical-inert')
    expect(c.id).not.toBe(ids.conv); expect(c.projectId).toBe(p.projects[0]!.project.id)
    expect(c.euOnly).toBe(true); expect(c.hasGoogleData).toBe(true); expect(c.hasProjectContext).toBe(true)
    expect(c.tags).toEqual(['privé']); expect(c.usedModels).toEqual(before.conversations[0]!.usedModels)
    expect(c.createdAt).toBe(3); expect(c.updatedAt).toBe(8)
    expect(m.content).toBe(before.conversations[0]!.messages[1]!.content)
    expect(m.factCheck).toEqual(before.conversations[0]!.messages[1]!.factCheck)
    expect(m.generatedImages).toEqual([p.files[0]!.file.id])
    expect(c.messages.every(message => message.restoredArchive === true)).toBe(true)
    expect(m).not.toHaveProperty('embeddedFiles')
    expect(m.projectTurn!.sources[0]!.documentId).toBe(p.projects[0]!.project.documents[0]!.id)
    expect(m.projectTurn!.sources[0]!.projectRevision).toBe(6)
    expect(p.projects[0]!.project.revision).toBe(7)
    expect(p.projects[0]!.project).not.toHaveProperty('owner')
    expect(c.messages[2]!.files![0]!.visionCrop!.sourceFileId).toBe(p.files[0]!.file.id)
    const presentation = c.messages[0]!.files![0]!
    if (version === 2) {
      expect(presentation).toEqual({ ...before.conversations[0]!.messages[0]!.files![0]!.presentation, id: p.files[0]!.file.id })
      expect(p.files[0]!.recordedSize).toBe(790)
    } else {
      expect(presentation).toEqual({ id: p.files[0]!.file.id, name: 'été.png', type: 'image/png', size: 13, width: 1, height: 1, normalizationVersion: 2 })
      expect(p.files[0]!.recordedSize).toBe(13)
    }
    expect(p.files[0]!.file.size).toBe(13)
    expect(presentation).not.toHaveProperty('objectId'); expect(presentation).not.toHaveProperty('recordedSize')
    for (const [id, blob] of f.objects) expect(await prepared.object(id).arrayBuffer()).toEqual(await blob.arrayBuffer())
    const json = JSON.stringify(p.conversations.map(item => item.conversation))
    expect(p.resources.conversationJsonCodeUnits).toBe(json.length)
    expect(p.resources.conversationJsonUtf8Bytes).toBe(new TextEncoder().encode(json).length)
    expect(p.resources.objectBytes).toBe(f.snapshot.objects.reduce((n, o) => n + o.bytes, 0))
    expect(p.resources.base64Chars).toBe(f.snapshot.objects.reduce((n, o) => n + Math.ceil(o.bytes / 3) * 4, 0))
    expect(f.snapshot).toEqual(before); expect(forbidden).not.toHaveBeenCalled()
  })

  it('keeps optional/falsy fields distinct and a detached association without dropping declarations', async () => {
    const f = await source(2), c = f.snapshot.conversations[0]!
    c.title = ''; c.hasGoogleData = false; c.hasTrailContext = false; c.tags = ['work', 'Client Émile']
    c.messages[0]!.pinned = false; c.messages[0]!.interrupted = false; c.messages[0]!.timestamp = 0
    delete c.projectId
    const p = (await prepareWorkspaceRestore(await f.seal(), code, guard)).plan
    expect(p.conversations[0]!.conversation).toMatchObject({ title: '', hasGoogleData: false, hasTrailContext: false, tags: c.tags })
    expect(p.conversations[0]!.conversation).not.toHaveProperty('projectId')
    expect(p.conversations[0]!.conversation.messages[0]).toMatchObject({ pinned: false, interrupted: false, timestamp: 0 })
    expect(p.projects).toHaveLength(1); expect(p.files).toHaveLength(2)
    expect(p.conversations[0]!.conversation.messages[0]).not.toHaveProperty('factCheck')
  })

  it('preserves standalone declared projects/files with no conversations or historical references at all', async () => {
    const f = await source(2)
    f.snapshot.conversations = []
    const prepared = await prepareWorkspaceRestore(await f.seal(), code, guard), p = prepared.plan
    expect(p.conversations).toEqual([])
    expect(p.projects).toHaveLength(1); expect(p.files).toHaveLength(2)
    expect(p.resources.messages).toBe(0); expect(p.resources.documents).toBe(1)
    expect(p.mapping.ids.filter(e => e.kind === 'conversation' || e.kind === 'message')).toEqual([])
    for (const [id, blob] of f.objects) expect(await prepared.object(id).arrayBuffer()).toEqual(await blob.arrayBuffer())
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('preserves two divergent historical presentations of the same file without replacing either with global metadata', async () => {
    const f = await source(2), c = f.snapshot.conversations[0]!
    const secondPresentation = { name: 'Copie côté assistant.png', type: 'image/png', size: 99 }
    c.messages[1]!.files = [{ id: ids.file, presentation: secondPresentation }]
    const p = (await prepareWorkspaceRestore(await f.seal(), code, guard)).plan
    const first = p.conversations[0]!.conversation.messages[0]!.files![0]!, second = p.conversations[0]!.conversation.messages[1]!.files![0]!
    expect(first).toEqual({ ...c.messages[0]!.files![0]!.presentation, id: first.id })
    expect(second).toEqual({ ...secondPresentation, id: first.id })
    expect(second).not.toHaveProperty('width'); expect(first.width).toBe(0)
    expect(p.files[0]!.file.size).toBe(13); expect(p.files[0]!.recordedSize).toBe(790)
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('separates domains and same message/document IDs under different parents', async () => {
    const f = await source(), original = f.snapshot.conversations[0]!
    original.id = ids.file
    f.snapshot.conversations.push({ ...clone(original), id: 'second-conversation' })
    const second = clone(f.snapshot.projects[0]!), secondProject = randomUUID()
    second.id = secondProject
    for (const key of ['sourceObjectId', 'textObjectId'] as const) {
      const old = second.documents[0]![key], fresh = randomUUID()
      second.documents[0]![key] = fresh
      f.objects.set(fresh, f.objects.get(old)!)
      f.snapshot.objects.push({ ...f.snapshot.objects.find(o => o.id === old)!, id: fresh })
    }
    f.snapshot.projects.push(second)
    const p = (await prepareWorkspaceRestore(await f.seal(), code, guard)).plan
    expect(mapped(p.mapping, 'conversation', ids.file)).not.toBe(mapped(p.mapping, 'file', ids.file))
    expect(mapped(p.mapping, 'message', 'reply', ids.file)).not.toBe(mapped(p.mapping, 'message', 'reply', 'second-conversation'))
    expect(mapped(p.mapping, 'document', ids.doc, ids.project)).not.toBe(mapped(p.mapping, 'document', ids.doc, secondProject))
    expect(p.conversations[0]!.conversation.messages[0]!.files![0]!.id).toBe(p.conversations[1]!.conversation.messages[0]!.files![0]!.id)
    expect(new Set(p.mapping.ids.map(e => e.target)).size).toBe(p.mapping.ids.length)
  })

  it('remaps missing historical projects/documents/crop sources without resolving source IDs', async () => {
    const f = await source(), c = f.snapshot.conversations[0]!, missing = randomUUID()
    c.projectId = missing; c.messages[1]!.projectTurn!.projectId = missing
    c.messages[1]!.projectTurn!.sources[0]!.projectId = missing
    c.messages[2]!.files![0]!.visionCrop!.sourceFileId = 'missing-file'
    c.messages[2]!.files![0]!.visionCrop!.sourceFileIds = ['missing-file']
    const p = (await prepareWorkspaceRestore(await f.seal(), code, guard)).plan, restored = p.conversations[0]!.conversation
    expect(restored.projectId).toBe(mapped(p.mapping, 'project', missing))
    expect(restored.projectId).not.toBe(p.projects[0]!.project.id)
    expect(restored.messages[1]!.projectTurn!.sources[0]!.documentId).not.toBe(p.projects[0]!.project.documents[0]!.id)
    expect(restored.messages[2]!.files![0]!.visionCrop!.sourceFileId).toBe(mapped(p.mapping, 'file', 'missing-file'))
    expect(p.diagnostics).toEqual({ unavailableAssociatedProjects: 1, unavailableHistoricalSources: 1, unavailableCropSources: 1 })
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('deep-freezes the plan/record and replays the exact mapping, not a second import', async () => {
    const f = await source(), archive = await f.seal()
    const a = await prepareWorkspaceRestore(archive, code, guard), record = clone(a.plan.mapping)
    const replaying = prepareWorkspaceRestore(archive, code, guard, { replay: record, idFactory: () => { throw new Error('must not regenerate') } })
    record.ids[0]!.target = 'changed-after-call'
    const b = await replaying, newImport = await prepareWorkspaceRestore(archive, code, guard)
    expect(b.plan).toEqual(a.plan)
    expect(newImport.plan.mapping.ids).not.toEqual(a.plan.mapping.ids)
    expect(() => a.plan.mapping.ids.push(a.plan.mapping.ids[0]!)).toThrow()
    expect(() => { a.plan.mapping.ids[0]!.target = 'mutation' }).toThrow()
    expect(() => { a.plan.conversations[0]!.conversation.messages[0]!.content = 'mutation' }).toThrow()
  })

  it.each(['fingerprint', 'missing', 'extra', 'duplicate', 'collision', 'parent', 'field'] as const)('refuses a modified replay record: %s', async kind => {
    const f = await source(), archive = await f.seal(), initial = await prepareWorkspaceRestore(archive, code, guard)
    const replay = clone(initial.plan.mapping)
    if (kind === 'fingerprint') replay.fingerprint = '0'.repeat(64)
    if (kind === 'missing') replay.ids.pop()
    if (kind === 'extra') replay.ids.push(clone(replay.ids[0]!))
    if (kind === 'duplicate') replay.ids[1] = clone(replay.ids[0]!)
    if (kind === 'collision') replay.ids[1]!.target = replay.ids[0]!.target
    if (kind === 'parent') replay.ids.find(e => e.kind === 'message')!.parent = 'foreign'
    if (kind === 'field') Object.assign(replay.ids[0]!, { owner: 'foreign' })
    await expect(prepareWorkspaceRestore(archive, code, guard, { replay })).rejects.toThrow(/^backup_/)
  })

  it('refuses a replay from another valid archive and never invokes accessors', async () => {
    const f = await source(), a = await prepareWorkspaceRestore(await f.seal(), code, guard)
    await expect(prepareWorkspaceRestore(await f.seal(), code, guard, { replay: a.plan.mapping })).rejects.toThrow('backup_different')
    const get = vi.fn(() => a.plan.mapping.ids), replay = { ...a.plan.mapping }
    Object.defineProperty(replay, 'ids', { enumerable: true, get })
    await expect(prepareWorkspaceRestore(await f.seal(), code, guard, { replay })).rejects.toThrow('backup_format')
    expect(get).not.toHaveBeenCalled()
  })

  it.each([null, false, 0, ''])('refuses a malformed falsy replay (%s) without generating replacement IDs', async value => {
    const archive = await sealWorkspaceBackup(emptySnapshot(), new Map(), code, guard), idFactory = vi.fn(factory())
    await expect(prepareWorkspaceRestore(archive, code, guard, { replay: value as unknown as RestoreMappingRecord, idFactory })).rejects.toThrow('backup_format')
    expect(idFactory).not.toHaveBeenCalled()
  })

  it('refuses a valid bounded archive whose UUID/marker expansion exceeds the destination JSON budget', async () => {
    const snapshot = emptySnapshot()
    snapshot.conversations.push({ id: 'c', title: '', createdAt: 0, updatedAt: 0, messages: Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`, role: 'user' as const, timestamp: 0, content: '', embeddedFiles: [],
    })) })
    const manifest = { ...snapshot, format: 'arty-workspace', version: 1, minReader: 1,
      features: BACKUP_FEATURES, archiveId: randomUUID(), createdAt: Date.now() }
    const available = BACKUP_LIMITS.manifestBytes - new TextEncoder().encode(JSON.stringify(manifest)).length - 256
    for (let i = 0, left = available; left > 0; i++) {
      const chars = Math.min(BACKUP_LIMITS.contentChars, left)
      snapshot.conversations[0]!.messages[i]!.content = 'x'.repeat(chars); left -= chars
    }
    const archive = await sealWorkspaceBackup(snapshot, new Map(), code, guard)
    await expect(openWorkspaceBackup(archive, code, guard)).resolves.toBeDefined()
    await expect(prepareWorkspaceRestore(archive, code, guard, { idFactory: factory() })).rejects.toThrow('backup_limit')
    expect(forbidden).not.toHaveBeenCalled()
  })

  it.each(['source', 'object', 'duplicate', 'invalid'] as const)('refuses generated ID %s collisions/invalidity', async kind => {
    const f = await source()
    const id = kind === 'source' ? ids.file : kind === 'object' ? ids.fileObj : kind === 'duplicate' ? randomUUID() : 'invalid'
    await expect(prepareWorkspaceRestore(await f.seal(), code, guard, { idFactory: () => id })).rejects.toThrow('backup_format')
  })

  it.each(['role', 'count', 'mime', 'signature'] as const)('rejects A1-valid but unrenderable galleries: %s', async kind => {
    const f = await source(), m = f.snapshot.conversations[0]!.messages[1]!
    if (kind === 'role') m.role = 'user'
    if (kind === 'count') {
      for (let i = 0; i < 4; i++) {
        const id = randomUUID(), objectId = randomUUID()
        f.snapshot.files.push({ ...f.snapshot.files[0]!, id, objectId })
        f.snapshot.objects.push({ ...f.snapshot.objects[0]!, id: objectId })
        f.objects.set(objectId, f.objects.get(ids.fileObj)!); m.embeddedFiles.push(id)
      }
    }
    if (kind === 'mime') { f.snapshot.files[0]!.type = 'text/plain'; delete f.snapshot.files[0]!.normalizationVersion }
    if (kind === 'signature') {
      const blob = new Blob([new Uint8Array(13)])
      f.objects.set(ids.fileObj, blob); f.snapshot.objects[0]!.sha256 = await sha256(new Uint8Array(await blob.arrayBuffer()))
    }
    const archive = await f.seal()
    await expect(openWorkspaceBackup(archive, code, guard)).resolves.toBeDefined()
    await expect(prepareWorkspaceRestore(archive, code, guard)).rejects.toThrow('backup_format')
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('handles empty archives, cancellation, disposal, wrong code and corrupted ciphertext without partial output', async () => {
    const empty = await sealWorkspaceBackup(emptySnapshot(), new Map(), code, guard)
    expect((await prepareWorkspaceRestore(empty, code, guard)).plan.resources.objectBytes).toBe(0)
    const f = await source(), archive = await f.seal(), controller = new AbortController()
    await expect(prepareWorkspaceRestore(archive, code, { ...guard, signal: controller.signal }, {
      idFactory: () => { controller.abort(); return randomUUID() },
    })).rejects.toThrow('backup_cancelled')
    const prepared = await prepareWorkspaceRestore(archive, code, guard)
    prepared.dispose()
    expect(() => prepared.plan).toThrow('backup_cancelled')
    expect(() => prepared.object(ids.fileObj)).toThrow('backup_cancelled')
    await expect(prepareWorkspaceRestore(archive, code.replace('00112233', 'FFFFFFFF'), guard)).rejects.toThrow('backup_integrity')
    const bytes = new Uint8Array(await archive.arrayBuffer()); bytes[bytes.length - 1] ^= 1
    await expect(prepareWorkspaceRestore(new Blob([bytes]), code, guard)).rejects.toThrow('backup_integrity')
    expect(forbidden).not.toHaveBeenCalled()
  })
})
