import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { openWorkspaceBackup, sealWorkspaceBackup } from '../../services/workspaceBackup/archive'
import { parseManifest, validateSnapshot } from '../../services/workspaceBackup/schema'
import { code, fixture, forgeArchive, guard, ids, manifest } from '../helpers/workspaceBackup'

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function v2() {
  const f = await fixture()
  for (const file of f.snapshot.files) file.recordedSize = file.size * 4
  for (const c of f.snapshot.conversations) for (const m of c.messages) for (const ref of m.files ?? []) {
    ref.presentation = { name: 'Historique.png', type: '', size: 30_000_000, width: 8000, height: 0, normalizationVersion: 0 }
  }
  f.snapshot.conversations[0]!.messages.push({ id: 'variant', role: 'user', content: 'Autre affichage', timestamp: 9,
    embeddedFiles: [], files: [{ id: ids.file, presentation: { name: 'Autre nom', type: 'image/jpeg', size: 0 } }] })
  return f
}
describe('manifest v2 preserves display metadata independently of stored bytes', () => {
  it('reads original v1 and round-trips v2 variants of the same file without rewriting its metadata', async () => {
    const original = await fixture()
    expect((await openWorkspaceBackup(await sealWorkspaceBackup(original.snapshot, original.objects, code, guard), code, guard)).manifest.version).toBe(1)
    const f = await v2()
    const opened = await openWorkspaceBackup(await sealWorkspaceBackup(f.snapshot, f.objects, code, guard, 2), code, guard)
    expect(opened.manifest.version).toBe(2); expect(opened.manifest.minReader).toBe(2)
    expect(opened.manifest.conversations).toEqual(f.snapshot.conversations)
    expect(opened.manifest.files).toEqual(f.snapshot.files)
    for (const [id, blob] of f.objects) expect(await opened.object(id).arrayBuffer()).toEqual(await blob.arrayBuffer())
  })
  it('refuses an implicit downgrade and a v2 reference without presentation', async () => {
    const f = await v2()
    expect(() => validateSnapshot(f.snapshot, 1)).toThrow('backup_format')
    await expect(sealWorkspaceBackup(f.snapshot, f.objects, code, guard)).rejects.toThrow('backup_format')
    delete f.snapshot.conversations[0]!.messages[0]!.files![0]!.presentation
    expect(() => validateSnapshot(f.snapshot, 2)).toThrow('backup_format')
  })
  it.each(['data', 'path', 'url', 'owner', 'visionCrop'])('rejects extra presentation field %s', async field => {
    const f = await v2()
    Object.assign(f.snapshot.conversations[0]!.messages[0]!.files![0]!.presentation!, { [field]: 'untrusted' })
    expect(() => validateSnapshot(f.snapshot, 2)).toThrow('backup_format')
  })
  it.each([[2, 1], [1, 2], [3, 3]])('rejects mismatched/unknown version %i minReader %i even with valid GCM', async (version, minReader) => {
    const f = await v2(), raw = { ...manifest(f.snapshot), version, minReader }
    expect(() => parseManifest(JSON.stringify(raw))).toThrow('backup_format')
    const chunks = await Promise.all(f.snapshot.objects.map(async o => new Uint8Array(await f.objects.get(o.id)!.arrayBuffer())))
    await expect(openWorkspaceBackup(await forgeArchive(raw, chunks), code, guard)).rejects.toThrow('backup_format')
  })
  it('refuses unsafe, negative or fractional historical sizes without comparing them to Blob size', async () => {
    const f = await v2(), presentation = f.snapshot.conversations[0]!.messages[0]!.files![0]!.presentation!
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      presentation.size = value
      expect(() => validateSnapshot(f.snapshot, 2)).toThrow('backup_format')
    }
  })
})
