import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { Blob as NodeBlob } from 'node:buffer'
import { validateSnapshot, parseManifest } from '../../services/workspaceBackup/schema'
import { sealWorkspaceBackup, openWorkspaceBackup } from '../../services/workspaceBackup/archive'
import { emptySnapshot, manifest, guard, code, forgeArchive } from '../helpers/workspaceBackup'

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NodeBlob) })
afterEach(() => vi.unstubAllGlobals())
function restricted() {
  const snapshot = emptySnapshot()
  snapshot.conversations.push({ id: 'c', title: 'Données', createdAt: 1, updatedAt: 2, hasProjectContext: true, outputRestriction: 'client-reply-draft-v1',
    messages: [{ id: 'm', role: 'assistant', timestamp: 2, content: 'Exact\r\nnon modifié', embeddedFiles: [], interrupted: true }] })
  return snapshot
}
describe('manifest v3 — restrictive output fidelity without enabling restore', () => {
  it('round-trips the restriction and raw content under authenticated encryption', async () => {
    const snapshot = restricted(), blob = await sealWorkspaceBackup(snapshot, new Map(), code, guard, 3)
    const read = await openWorkspaceBackup(blob, code, guard)
    expect(read.manifest.version).toBe(3); expect(read.manifest.minReader).toBe(3)
    expect(read.manifest.conversations).toEqual(snapshot.conversations)
    expect(Object.isFrozen(read.manifest.conversations[0])).toBe(true)
  })
  it.each([1, 2] as const)('refuses to silently strip the new field from schema v%s', version => {
    expect(() => validateSnapshot(restricted(), version)).toThrow('backup_format')
  })
  it.each([undefined, null, false, 'sent', 'client-reply-draft-v2'])('refuses a present invalid restriction %j', value => {
    const snapshot = restricted()
    Object.assign(snapshot.conversations[0]!, { outputRestriction: value })
    expect(() => validateSnapshot(snapshot, 3)).toThrow('backup_format')
  })
  it('requires documentary closure and leaves previous schemas readable', () => {
    const snapshot = restricted(); snapshot.conversations[0]!.hasProjectContext = false
    expect(() => validateSnapshot(snapshot, 3)).toThrow('backup_format')
    for (const version of [1, 2] as const) expect(parseManifest(JSON.stringify({ ...manifest(emptySnapshot()), version, minReader: version })).version).toBe(version)
  })
  it.each([[3, 2], [2, 3], [4, 4]])('rejects version %i/minReader%i even with valid authentication', async (version, minReader) => {
    const value = { ...manifest(emptySnapshot()), version, minReader }
    expect(() => parseManifest(JSON.stringify(value))).toThrow('backup_format')
    await expect(openWorkspaceBackup(await forgeArchive(value, []), code, guard)).rejects.toThrow('backup_format')
  })
})
