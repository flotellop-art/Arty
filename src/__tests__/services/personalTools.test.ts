import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/memoryService', () => ({ readMemory: vi.fn(), updateMemory: vi.fn() }))
vi.mock('../../services/reportGenerator', () => ({ openReport: vi.fn() }))
vi.mock('../../services/native/platform', () => ({ isNative: true, platform: 'android' }))
vi.mock('../../services/native/filesystem', () => ({ writeLocalFile: vi.fn(), listLocalFiles: vi.fn(), readLocalFile: vi.fn(), deleteLocalFile: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: async () => 'test-token' }))
vi.mock('../../services/factChecker', () => ({ setSearchContext: vi.fn() }))
import { readMemory, updateMemory } from '../../services/memoryService'
import { openReport } from '../../services/reportGenerator'
import { writeLocalFile } from '../../services/native/filesystem'
import { createUtilityHandlers } from '../../services/tools/utilityTools'
import { createNativeHandlers } from '../../services/tools/nativeTools'
import { executeClientWebSearch } from '../../services/tools/clientWebSearch'
import { buildPortableTools, toolAttemptKey } from '../../services/tools/personalToolPolicy'
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('shared personal tools', () => {
  it('requires a memory read within this invocation before replacement', async () => {
    vi.mocked(readMemory).mockResolvedValue(['existing'])
    vi.mocked(updateMemory).mockResolvedValue({ success: true, message: 'saved' })
    const handlers = createUtilityHandlers()
    const context = { memory: { readReceipts: new Map<string, string>() }, invocation: { assertCurrent: vi.fn() } }
    expect((await handlers.update_memory({ category: 'notes', data: ['new'] }, context)).result).toContain('Lis d’abord')
    expect(updateMemory).not.toHaveBeenCalled()
    const precomputedWrite = { category: 'notes', data: ['new'] }
    const read = await handlers.read_memory({ category: 'notes' }, context)
    await handlers.update_memory(precomputedWrite, context)
    expect(updateMemory).not.toHaveBeenCalled() // even after execution of the read in the same provider batch
    const receipt = JSON.parse(read.result).read_receipt
    await handlers.update_memory({ category: 'notes', data: ['existing', 'new'], read_receipt: receipt }, context)
    expect(updateMemory).toHaveBeenCalledWith('notes', ['existing', 'new'], context.invocation)
    await handlers.update_memory({ category: 'notes', data: ['replay'], read_receipt: receipt }, context)
    expect(updateMemory).toHaveBeenCalledOnce()
    await handlers.update_memory({ category: 'clients', data: [] }, context)
    expect(updateMemory).toHaveBeenCalledOnce()
    await handlers.update_memory({ category: 'notes', data: ['other'] }, { memory: { readReceipts: new Map() } })
    expect(updateMemory).toHaveBeenCalledOnce()
  })
  it('passes Stop authority into report persistence', async () => {
    const assertCurrent = vi.fn()
    vi.mocked(openReport).mockResolvedValue('id')
    await createUtilityHandlers().generate_report({ title: 'T', content: 'C' }, { invocation: { assertCurrent } })
    expect(openReport).toHaveBeenCalledWith('T', 'C', assertCurrent)
  })
  it('reports native save failures truthfully and keeps unsupported Android readers absent', async () => {
    vi.mocked(writeLocalFile).mockResolvedValue(null)
    expect((await createNativeHandlers().save_local_file({ path: 'test.txt', content: 'test' })).result).toContain('Échec')
    const names = buildPortableTools({ personalTools: true }).map(tool => tool.name)
    expect(names).toContain('save_local_file')
    expect(names).not.toContain('read_local_file')
    expect(names).not.toContain('list_local_files')
    expect(names).not.toContain('read_drive_file')
  })
  it('detects the same write despite recursively reordered arguments', () => {
    expect(toolAttemptKey('update_memory', { data: { b: 2, a: [1, { y: 2, x: 1 }] }, category: 'profil' }))
      .toBe(toolAttemptKey('update_memory', { category: 'profil', data: { a: [1, { x: 1, y: 2 }], b: 2 } }))
  })
  it('retains per-source citations but never authorizes synthetic answer URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ provider: 'Linkup', bySource: {
      'official.example': { answer: 'See https://invented.example/wrong', results: [{ title: 'Official', url: 'https://official.example/fact', snippet: 'source' }] },
    } })))
    const result = await executeClientWebSearch({ query: 'comparison' })
    expect(result.result).toContain('https://official.example/fact')
    expect(result.sourceUrls).toEqual(['https://official.example/fact'])
  })
})
