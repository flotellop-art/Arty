import { beforeEach, describe, expect, it, vi } from 'vitest'
import fixtures from '../helpers/office-producer-fixtures.json'
import type { ProjectOperation } from '../../services/projects/store'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
let prepare: typeof import('../../services/projects/documentImport')['prepareProjectDocument']
let current: boolean
const op = { assertCurrent() { if (!current) throw new Error('cancelled') } } as ProjectOperation
function file(bytes: Uint8Array, name = 'notes.txt'): File {
  return { name, size: bytes.length, type: 'application/octet-stream', arrayBuffer: vi.fn(async () => Uint8Array.from(bytes).buffer) } as unknown as File
}
beforeEach(async () => {
  vi.resetModules(); localStorage.clear(); current = true
  const users = await import('../../services/userSession')
  users.setActiveSession({ userId: 'a', displayName: 'A', authMethod: 'apikey', createdAt: 1 })
  await (await import('../../services/crypto')).initCrypto('test-import')
  prepare = (await import('../../services/projects/documentImport')).prepareProjectDocument
})
describe('project document import adapter', () => {
  it('normalizes extracted CRLF but hashes and retains the exact UTF-8 original bytes', async () => {
    const source = 'Rénovation\r\nCoût : 2400 €', bytes = new TextEncoder().encode(source)
    const prepared = await prepare(op, file(bytes, 'coût.csv'))
    expect(prepared.text).toBe('Rénovation\nCoût : 2400 €')
    expect(atob(prepared.base64)).toBe(Array.from(bytes, b => String.fromCharCode(b)).join(''))
    expect(prepared.descriptor.sourceBytes).toBe(bytes.length)
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
    expect(prepared.descriptor.sourceHash).toBe(hash)
    expect(prepared.descriptor.originalName).toBe('coût.csv')
  })
  it.each(['docx', 'xlsx'] as const)('reads the real %s producer fixture using the original filename, not MIME', async kind => {
    const prepared = await prepare(op, file(Uint8Array.from(Buffer.from(fixtures[kind], 'base64')), `producer.${kind}`))
    expect(prepared.descriptor.format).toBe(kind)
    expect(prepared.descriptor.extractorVersion).toBe('arty-project-text-v1')
    expect(prepared.text.length).toBeGreaterThan(100)
  })
  it.each(['notes.pdf', 'notes.doc', 'notes.xls', 'notes.docm', 'notes.exe'])('rejects unsupported %s before reading bytes', async name => {
    const input = file(new Uint8Array([1, 2, 3]), name)
    await expect(prepare(op, input)).rejects.toMatchObject({ code: 'unsupported' })
    expect(input.arrayBuffer).not.toHaveBeenCalled()
  })
  it('rejects ANSI/non-UTF8 and NUL content instead of replacing characters', async () => {
    await expect(prepare(op, file(new Uint8Array([0xe9])))).rejects.toMatchObject({ code: 'unsupported' })
    await expect(prepare(op, file(new Uint8Array([65, 0, 66])))).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('rejects an oversized text instead of silently indexing its prefix', async () => {
    await expect(prepare(op, file(new Uint8Array(200_001).fill(65)))).rejects.toMatchObject({ code: 'limit' })
  })
  it('maps Office parsing failures to the project error contract', async () => {
    await expect(prepare(op, file(new TextEncoder().encode('not a ZIP'), 'broken.docx'))).rejects.toMatchObject({ code: 'corrupt' })
  })
  it('cancels after a delayed read before hashing or returning a prepared handle', async () => {
    const bytes = new Uint8Array([65]), input = file(bytes)
    input.arrayBuffer = async () => { current = false; return bytes.buffer }
    await expect(prepare(op, input)).rejects.toThrow('cancelled')
  })
})
