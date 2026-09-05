import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { calculateArchiveLayout, openWorkspaceBackup, sealWorkspaceBackup } from '../../services/workspaceBackup/archive'
import { createRecoveryCode, readRecoveryCode, sha256 } from '../../services/workspaceBackup/bytes'
import { BACKUP_LIMITS as L } from '../../services/workspaceBackup/types'
import { validateSnapshot, parseManifest, validateGraph } from '../../services/workspaceBackup/schema'
import { code, emptySnapshot, fixture, forgeArchive, guard, ids, manifest } from '../helpers/workspaceBackup'

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
const emptyArchive = () => sealWorkspaceBackup(emptySnapshot(), new Map(), code, guard)
const fixtureDir = process.env.ARTY_BACKUP_FIXTURE_DIR

describe('workspace archive: real WebCrypto, no application persistence', () => {
  it('round-trips the full cross-linked graph and exact bytes across chunk boundaries', async () => {
    const { snapshot, objects } = await fixture(true)
    const archive = await sealWorkspaceBackup(snapshot, objects, code, guard), opened = await openWorkspaceBackup(archive, code, guard)
    for (const key of ['conversations', 'projects', 'files', 'objects'] as const) expect(opened.manifest[key]).toEqual(snapshot[key])
    expect(opened.diagnostics).toEqual({ unavailableAssociatedProjects: 0, unavailableHistoricalSources: 0, unavailableCropSources: 0 })
    for (const [id, blob] of objects) expect(await bytesOf(opened.object(id))).toEqual(await bytesOf(blob))
    expect(Object.isFrozen(opened.manifest.conversations[0]!.messages)).toBe(true)
    expect(() => opened.object('not-an-id')).toThrow('backup_missing')
    const raw = Buffer.from(await archive.arrayBuffer())
    for (const privateValue of ['Travail confidentiel', 'Dossier privé', 'Analyse mon document', code]) expect(raw.includes(Buffer.from(privateValue))).toBe(false)
    if (fixtureDir) {
      // Explicitly requested synthetic fixture output, never application data.
      writeFileSync(join(fixtureDir, 'arty-workspace.artybackup'), raw)
      const data: Record<string, string> = {}
      for (const [id, blob] of objects) data[id] = Buffer.from(await blob.arrayBuffer()).toString('base64')
      writeFileSync(join(fixtureDir, 'expected.json'), JSON.stringify({ snapshot, objects: data }))
    }
  })
  it.runIf(!!fixtureDir && existsSync(join(fixtureDir!, 'python.artybackup')))('reads the independent Python producer fixture', async () => {
    const expected = JSON.parse(readFileSync(join(fixtureDir!, 'python-expected.json'), 'utf8'))
    const opened = await openWorkspaceBackup(new Blob([readFileSync(join(fixtureDir!, 'python.artybackup'))]), code, guard)
    for (const key of ['conversations', 'projects', 'files', 'objects'] as const) expect(opened.manifest[key]).toEqual(expected.snapshot[key])
    for (const [id, encoded] of Object.entries(expected.objects)) expect(Buffer.from(await opened.object(id).arrayBuffer()).toString('base64')).toBe(encoded)
  })
  it('accepts a genuinely empty selected workspace without inventing objects', async () => {
    const opened = await openWorkspaceBackup(await emptyArchive(), code.toLowerCase(), guard)
    expect(opened.manifest.objects).toEqual([])
  })
  it('produces distinct archive IDs, salts and ciphertext for identical input and recovery code', async () => {
    const a = await bytesOf(await emptyArchive()), b = await bytesOf(await emptyArchive())
    expect(a.slice(8, 24)).not.toEqual(b.slice(8, 24)); expect(a.slice(24, 56)).not.toEqual(b.slice(24, 56)); expect(a.slice(64)).not.toEqual(b.slice(64))
  })
  it('generates 256-bit formatted recovery codes and rejects arbitrary passwords', () => {
    const a = createRecoveryCode(), b = createRecoveryCode()
    expect(a).toMatch(/^ARTY1-(?:[A-F0-9]{8}-){7}[A-F0-9]{8}$/); expect(a).not.toBe(b)
    expect(readRecoveryCode(` ${a.toLowerCase()} `)).toHaveLength(32)
    for (const bad of ['server-provided', 'password', code.slice(0, -1), `${code}-00`, code.replace('ARTY1', 'ARTY2'), 'x'.repeat(10000)]) expect(() => readRecoveryCode(bad)).toThrow('backup_secret')
  })
  it('does not export derived keys and uses a fixed HKDF domain', async () => {
    const derive = vi.spyOn(crypto.subtle, 'deriveKey'), encode = vi.spyOn(crypto.subtle, 'encrypt')
    await emptyArchive()
    expect(derive.mock.calls[0]![0]).toMatchObject({ name: 'HKDF', hash: 'SHA-256' })
    expect(new TextDecoder().decode(derive.mock.calls[0]![0].info as Uint8Array)).toBe('arty-workspace-backup/v1')
    expect(derive.mock.calls[0]![3]).toBe(false)
    expect(encode.mock.calls[0]![0]).toMatchObject({ name: 'AES-GCM', tagLength: 128 })
    expect(encode.mock.calls[0]![1].extractable).toBe(false)
  })
  it('refuses a wrong valid-shaped secret without revealing content', async () => {
    await expect(openWorkspaceBackup(await emptyArchive(), createRecoveryCode(), guard)).rejects.toThrow(/^backup_integrity$/)
  })
  it.each([0, 7, 8, 23, 24, 55, 56, 59, 60, 63, 64, 68, 72, 74])('rejects tampering at byte %i', async index => {
    const bytes = await bytesOf(await emptyArchive()); bytes[index] ^= 1
    await expect(openWorkspaceBackup(new Blob([bytes]), code, guard)).rejects.toThrow(/^backup_/)
  })
  it('checks unauthenticated header bounds before deriving a key or allocating the manifest', async () => {
    const bytes = await bytesOf(await emptyArchive()), derive = vi.spyOn(crypto.subtle, 'deriveKey')
    new DataView(bytes.buffer).setUint32(60, L.manifestBytes + 1)
    await expect(openWorkspaceBackup(new Blob([bytes]), code, guard)).rejects.toThrow('backup_limit')
    expect(derive).not.toHaveBeenCalled()
  })
  it.each([0, 1, 63, 64, 65, 88, -1])('rejects truncation at %i', async end => {
    const archive = await emptyArchive()
    await expect(openWorkspaceBackup(archive.slice(0, end), code, guard)).rejects.toThrow(/^backup_/)
  })
  it('rejects bytes after EOF and an over-limit input before reading its body', async () => {
    await expect(openWorkspaceBackup(new Blob([await emptyArchive(), 'junk']), code, guard)).rejects.toThrow('backup_format')
    const oversized = new Blob([new Uint8Array(L.archiveBytes + 1)]), read = vi.spyOn(oversized, 'arrayBuffer')
    await expect(openWorkspaceBackup(oversized, code, guard)).rejects.toThrow('backup_limit'); expect(read).not.toHaveBeenCalled()
  })
  it('refuses permutation, duplication and cross-archive substitution of frames', async () => {
    const f = await fixture(true), a = await bytesOf(await sealWorkspaceBackup(f.snapshot, f.objects, code, guard))
    const b = await bytesOf(await sealWorkspaceBackup(f.snapshot, f.objects, code, guard))
    const start = 64 + 25 + new DataView(a.buffer).getUint32(60)
    const firstSize = 25 + L.chunkBytes, secondSize = 25 + 13
    const first = a.slice(start, start + firstSize), second = a.slice(start + firstSize, start + firstSize + secondSize)
    const variants = [
      new Blob([a.slice(0, start), second, first, a.slice(start + firstSize + secondSize)]),
      new Blob([a.slice(0, start + firstSize), first, a.slice(start + firstSize)]),
      new Blob([a.slice(0, start), b.slice(start, start + firstSize), a.slice(start + firstSize)]),
    ]
    for (const variant of variants) await expect(openWorkspaceBackup(variant, code, guard)).rejects.toThrow(/^backup_/)
  })
  it('detects an inconsistent digest even when every GCM tag is valid', async () => {
    const f = await fixture(), m = manifest(f.snapshot)
    m.objects[0]!.sha256 = '0'.repeat(64)
    const chunks = await Promise.all(m.objects.map(o => bytesOf(f.objects.get(o.id)!)))
    await expect(openWorkspaceBackup(await forgeArchive(m, chunks), code, guard)).rejects.toThrow('backup_integrity')
  })
  it('rejects validly tagged invalid UTF-8 in the manifest', async () => {
    await expect(openWorkspaceBackup(await forgeArchive(new Uint8Array([0xc3, 0x28])), code, guard)).rejects.toThrow('backup_format')
  })
  it('rejects validly tagged invalid UTF-8 or wrong character counts in document text', async () => {
    for (const replacement of [new Uint8Array([0xc3, 0x28]), new TextEncoder().encode('wrong length')]) {
      const f = await fixture(), m = manifest(f.snapshot), obj = m.objects.find(o => o.id === ids.textObj)!
      obj.bytes = replacement.length; obj.sha256 = await sha256(replacement); f.objects.set(ids.textObj, new Blob([replacement]))
      const chunks = await Promise.all(m.objects.map(o => bytesOf(f.objects.get(o.id)!)))
      await expect(openWorkspaceBackup(await forgeArchive(m, chunks), code, guard)).rejects.toThrow(/^backup_(format|integrity)$/)
    }
  })
  it('rejects header/manifest archive-ID disagreement despite valid tags', async () => {
    await expect(openWorkspaceBackup(await forgeArchive(manifest(), [], { headerId: crypto.randomUUID() }), code, guard)).rejects.toThrow('backup_integrity')
  })
  it('snapshots metadata and the caller Map before the first await', async () => {
    const f = await fixture(), original = JSON.parse(JSON.stringify(f.snapshot))
    const pending = sealWorkspaceBackup(f.snapshot, f.objects, code, guard)
    f.snapshot.conversations[0]!.title = 'CHANGED'; f.objects.clear()
    const opened = await openWorkspaceBackup(await pending, code, guard)
    expect(opened.manifest.conversations).toEqual(original.conversations)
  })
  it('does not release an archive on missing or mismatched source bytes', async () => {
    const f = await fixture()
    f.objects.set(ids.cropObj, new Blob([new Uint8Array([0, 0, 0])]))
    await expect(sealWorkspaceBackup(f.snapshot, f.objects, code, guard)).rejects.toThrow('backup_integrity')
    f.objects.delete(ids.cropObj)
    await expect(sealWorkspaceBackup(f.snapshot, f.objects, code, guard)).rejects.toThrow('backup_missing')
  })
  it.each(['encrypt', 'decrypt'])('cancels after pending %s without publishing a result', async method => {
    const archive = await emptyArchive(), ctrl = new AbortController(), g = { ...guard, signal: ctrl.signal }
    const actual = crypto.subtle[method].bind(crypto.subtle)
    vi.spyOn(crypto.subtle, method).mockImplementationOnce(async (...args) => {
      const result = await actual(...args); ctrl.abort(); return result
    })
    const pending = method === 'encrypt' ? sealWorkspaceBackup(emptySnapshot(), new Map(), code, g) : openWorkspaceBackup(archive, code, g)
    await expect(pending).rejects.toThrow('backup_cancelled')
  })
  it('guards late access to already validated objects and metadata', async () => {
    let current = true
    const opened = await openWorkspaceBackup(await emptyArchive(), code, { assertCurrent() { if (!current) throw new Error('changed') } })
    current = false
    expect(() => opened.manifest).toThrow('changed'); expect(() => opened.diagnostics).toThrow('changed'); expect(() => opened.object('x')).toThrow('changed')
  })
  it('has no network/storage/session side effects, including on failure', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network forbidden') }); vi.stubGlobal('fetch', fetchSpy)
    const set = vi.spyOn(Storage.prototype, 'setItem'), remove = vi.spyOn(Storage.prototype, 'removeItem')
    const archive = await emptyArchive(); await openWorkspaceBackup(archive, code, guard)
    await expect(openWorkspaceBackup(archive, createRecoveryCode(), guard)).rejects.toThrow('backup_integrity')
    expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('archive admission and untrusted graph', () => {
  it('bounds objects, frames, UTF-8 manifest and total plaintext independently', () => {
    expect(calculateArchiveLayout([L.objectBytes], L.manifestBytes).frames).toBe(41)
    expect(calculateArchiveLayout([L.chunkBytes, L.chunkBytes + 1], 1).frames).toBe(4)
    const six = Array(5).fill(L.objectBytes)
    expect(calculateArchiveLayout([...six, L.objectBytes - 1], 1).plaintext).toBe(L.plaintextBytes)
    for (const [objects, size] of [[[], 0], [[], L.manifestBytes + 1], [[0], 1], [[-1], 1], [[1.5], 1], [[Infinity], 1], [[L.objectBytes + 1], 1],
      [Array(257).fill(1), 1], [Array(1), 1], [[...six, L.objectBytes], 1]] as [number[], number][]) expect(() => calculateArchiveLayout(objects, size)).toThrow('backup_limit')
    // Many small objects add frame overhead. The 60 MiB aggregate limit is
    // reached before 512 frames at the current 256-object limit.
    expect(calculateArchiveLayout([...Array(239).fill(L.chunkBytes + 1), ...Array(17).fill(1)], 1).frames).toBe(496)
    expect(() => calculateArchiveLayout(Array(256).fill(L.chunkBytes + 1), 1)).toThrow('backup_limit')
  })
  it.each(['version', 'minReader', 'features', 'extra', 'format'])('rejects unsupported manifest contract: %s', key => {
    const m = manifest() as unknown as Record<string, unknown>
    m[key] = key === 'features' ? ['additive-restore', 'inert-restore', 'unknown'] : key === 'format' ? 'other' : 2
    expect(() => parseManifest(JSON.stringify(m))).toThrow('backup_format')
  })
  it('accepts old attribution IDs, interrupted messages and unavailable historic sources', async () => {
    const f = await fixture(), m = f.snapshot.conversations[0]!.messages[1]!
    m.projectTurn!.sources[0]!.documentId = ids.old
    expect(() => validateSnapshot(f.snapshot)).not.toThrow()
    expect(validateGraph(f.snapshot).unavailableHistoricalSources).toBe(1)
  })
  it('reports a non-included association without resolving an arbitrary local project', async () => {
    const f = await fixture(); f.snapshot.conversations[0]!.projectId = ids.old
    expect(() => validateSnapshot(f.snapshot)).not.toThrow()
    expect(validateGraph(f.snapshot).unavailableAssociatedProjects).toBe(1)
  })
  it.each(['euOnly', 'hasProjectContext'])('refuses weakened %s restrictions even with private historical turns', async flag => {
    const f = await fixture(); f.snapshot.conversations[0]![flag] = false
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
  })
  it('refuses a missing direct attachment, generated image, or live document object', async () => {
    for (const type of ['attachment', 'image', 'document']) {
      const f = await fixture()
      if (type === 'attachment') f.snapshot.conversations[0]!.messages[0]!.files![0]!.id = ids.old
      if (type === 'image') { f.snapshot.conversations[0]!.messages[0]!.content = `![x](arty-img://${ids.old})`; f.snapshot.conversations[0]!.messages[0]!.embeddedFiles = [ids.old] }
      if (type === 'document') f.snapshot.projects[0]!.documents[0]!.sourceObjectId = ids.old
      expect(() => validateSnapshot(f.snapshot)).toThrow('backup_missing')
    }
  })
  it('reports an unavailable crop origin, and rejects a self-reference', async () => {
    const f = await fixture(), crop = f.snapshot.conversations[0]!.messages[2]!.files![0]!.visionCrop!
    crop.sourceFileId = ids.old; crop.sourceFileIds = [ids.old]
    expect(() => validateSnapshot(f.snapshot)).not.toThrow(); expect(validateGraph(f.snapshot).unavailableCropSources).toBe(1)
    crop.sourceFileId = ids.crop; crop.sourceFileIds = [ids.crop]
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
  })
  it.each([{ x: 100, y: 0, width: 1, height: 1 }, { x: 0.6, y: 0, width: 0.6, height: 1 },
    { x: 0, y: 0.6, width: 1, height: 0.6 }, { x: 0, y: 0, width: 0, height: 1 }])('requires an actual normalized crop rectangle: %j', async rect => {
    const f = await fixture(); f.snapshot.conversations[0]!.messages[2]!.files![0]!.visionCrop!.rect = rect
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
  })
  it('does not mistake literal or fenced URI examples for declared rendered assets', async () => {
    const f = await fixture(); f.snapshot.conversations[0]!.messages[0]!.content = 'Explique `arty-img://example`\n```md\n![exemple](arty-img://absent)\n```'
    const opened = await openWorkspaceBackup(await sealWorkspaceBackup(f.snapshot, f.objects, code, guard), code, guard)
    expect(opened.manifest.conversations[0]!.messages[0]!.content).toContain('arty-img://example')
  })
  it.each(['absent', 'duplicate', 'unknown'])('requires a strict declared image table: %s', async mode => {
    const f = await fixture(), message = f.snapshot.conversations[0]!.messages[1]!
    if (mode === 'absent') delete message.embeddedFiles
    else message.embeddedFiles = mode === 'duplicate' ? [ids.file, ids.file] : [ids.old]
    expect(() => validateSnapshot(f.snapshot)).toThrow(mode === 'unknown' ? 'backup_missing' : 'backup_format')
  })
  it('keeps known EU source restrictions even when a detached historical turn understates them', async () => {
    const f = await fixture(), conv = f.snapshot.conversations[0]!
    delete conv.projectId; conv.euOnly = false; conv.messages[1]!.projectTurn!.euOnly = false
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
  })
  it('reports crop relocalisation unavailable for historical v1 normalization', async () => {
    const f = await fixture(); f.snapshot.files[0]!.normalizationVersion = 1
    const opened = await openWorkspaceBackup(await sealWorkspaceBackup(f.snapshot, f.objects, code, guard), code, guard)
    expect(opened.diagnostics.unavailableCropSources).toBe(1)
  })
  it('uses actual extracted text lines to diagnose historical out-of-range locators', async () => {
    const f = await fixture(), source = f.snapshot.conversations[0]!.messages[1]!.projectTurn!.sources[0]!
    source.startLine = 4; source.endLine = 4
    const opened = await openWorkspaceBackup(await sealWorkspaceBackup(f.snapshot, f.objects, code, guard), code, guard)
    expect(opened.diagnostics.unavailableHistoricalSources).toBe(1)
  })
  it('preserves only allowlisted historical quick actions and fact-check proof', async () => {
    const f = await fixture(); expect(() => validateSnapshot(f.snapshot)).not.toThrow()
    f.snapshot.conversations[0]!.messages[0]!.quickAction!.id = 'executeScript'
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
    f.snapshot.conversations[0]!.messages[0]!.quickAction!.id = 'summarize'
    f.snapshot.conversations[0]!.messages[1]!.factCheck!.claims[0]!.verdict = 'trusted'
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
  })
  it.each(['conversations', 'projects', 'files', 'objects', 'messages', 'documents'])('rejects duplicate %s IDs', async key => {
    const f = await fixture()
    const array = key === 'messages' ? f.snapshot.conversations[0]!.messages : key === 'documents' ? f.snapshot.projects[0]!.documents : f.snapshot[key]
    array.push(JSON.parse(JSON.stringify(array[0])))
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
  })
  it('refuses unknown nested fields and object reuse under another type', async () => {
    const f = await fixture()
    f.snapshot.conversations[0]!.messages[0]!.apiKey = 'MUST NOT ENTER ERROR'
    expect(() => validateSnapshot(f.snapshot)).toThrow(/^backup_format$/)
    delete f.snapshot.conversations[0]!.messages[0]!.apiKey
    f.snapshot.files[0]!.objectId = ids.textObj
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
  })
  it('refuses cycles, getters, nonfinite numbers, sparse arrays and deep JSON', () => {
    const root = emptySnapshot(); root.projects = [root]
    expect(() => validateSnapshot(root)).toThrow('backup_format')
    const accessor = emptySnapshot(), spy = vi.fn(); Object.defineProperty(accessor, 'conversations', { get: spy })
    expect(() => validateSnapshot(accessor)).toThrow('backup_format'); expect(spy).not.toHaveBeenCalled()
    const sparse = emptySnapshot(); sparse.files = Array(1)
    expect(() => validateSnapshot(sparse)).toThrow('backup_format')
    let deep: unknown = 1; for (let i = 0; i < L.jsonDepth + 1; i++) deep = { a: deep }
    expect(() => parseManifest(JSON.stringify({ ...manifest(), extra: deep }))).toThrow('backup_limit')
    const m = manifest(); m.createdAt = Infinity
    expect(() => parseManifest(JSON.stringify(m))).toThrow('backup_format')
    expect(() => parseManifest('{"__proto__":{}}')).toThrow('backup_format')
  })
  it('refuses hidden array toJSON and custom prototypes before serialization can run', async () => {
    const snapshot = emptySnapshot(), toJSON = vi.fn(() => [])
    Object.defineProperty(snapshot.conversations, 'toJSON', { value: toJSON, enumerable: false })
    await expect(sealWorkspaceBackup(snapshot, new Map(), code, guard)).rejects.toThrow('backup_format')
    expect(toJSON).not.toHaveBeenCalled()
    const second = emptySnapshot(); Object.setPrototypeOf(second.conversations, Object.create(Array.prototype))
    expect(() => validateSnapshot(second)).toThrow('backup_format')
  })
  it('budgets extreme depth and width before JSON.parse, including authenticated adversarial input', async () => {
    const deep = '['.repeat(700_000) + '0' + ']'.repeat(700_000), wide = '[' + '0,'.repeat(L.jsonNodes) + '0]'
    const parse = vi.spyOn(JSON, 'parse')
    expect(() => parseManifest(deep)).toThrow('backup_limit'); expect(() => parseManifest(wide)).toThrow('backup_limit')
    expect(parse).not.toHaveBeenCalled()
    const archive = await forgeArchive(new TextEncoder().encode(deep))
    parse.mockClear(); await expect(openWorkspaceBackup(archive, code, guard)).rejects.toThrow('backup_limit')
    expect(parse).not.toHaveBeenCalled()
  })
  it('lexical preflight ignores structural tokens and escaped quotes inside text', async () => {
    const f = await fixture(); f.snapshot.conversations[0]!.messages[0]!.content = '[{},: \\" \\]'.repeat(1000)
    expect(parseManifest(JSON.stringify(manifest(f.snapshot))).conversations).toEqual(f.snapshot.conversations)
  })
  it('does not silently replace lone surrogates or accept invalid enums/metadata', async () => {
    const f = await fixture(); f.snapshot.conversations[0]!.messages[0]!.content = '\ud800'
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_format')
    f.snapshot.conversations[0]!.messages[0]!.content = 'ok'; f.snapshot.files[0]!.normalizationVersion = 3
    expect(() => validateSnapshot(f.snapshot)).toThrow('backup_limit')
  })
})
