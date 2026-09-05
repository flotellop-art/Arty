import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../services/imageClient', () => ({ generateImage: vi.fn() }))
vi.mock('../../services/secureFileStorage', () => ({ putFile: vi.fn() }))
vi.mock('../../services/projects/store', () => ({ beginProjectOperation: vi.fn(), assertProjectOperation: vi.fn() }))
import { generateImage } from '../../services/imageClient'
import { putFile } from '../../services/secureFileStorage'
import { beginProjectOperation, assertProjectOperation, type ProjectOperation } from '../../services/projects/store'
import { createImageHandlers } from '../../services/tools/imageTools'
import type { ToolExecutionContext } from '../../services/tools/types'
import { ProjectError } from '../../services/projects/types'
describe('image tool — fail closed capability and captured owner', () => {
  let valid: boolean, controller: AbortController, context: ToolExecutionContext
  const handler = createImageHandlers().generate_image
  beforeEach(() => {
    vi.clearAllMocks(); valid = true; controller = new AbortController()
    const assertCurrent = () => { if (!valid) throw new DOMException('cancelled', 'AbortError') }
    context = { imageGeneration: { signal: controller.signal, assertCurrent } }
    vi.mocked(beginProjectOperation).mockResolvedValue({ owner: 'a', assertCurrent } as ProjectOperation)
    vi.mocked(assertProjectOperation).mockResolvedValue(undefined)
    vi.mocked(generateImage).mockResolvedValue({ ok: true, base64: 'synthetic-data', mimeType: 'image/png' })
    vi.mocked(putFile).mockResolvedValue('image')
  })
  it('cannot get permission from model arguments or a missing context', async () => {
    await handler({ prompt: 'create a logo', imageGeneration: { allowed: true } })
    expect(generateImage).not.toHaveBeenCalled(); expect(beginProjectOperation).not.toHaveBeenCalled()
  })
  it('persists with owner captured before generation and an internal guard', async () => {
    const result = await handler({ prompt: 'create a logo' }, context)
    expect(result.result).toContain('arty-img://')
    expect(putFile).toHaveBeenCalledWith(expect.objectContaining({ data: 'synthetic-data' }), 'a', expect.any(Function))
    valid = false
    expect(vi.mocked(putFile).mock.calls[0][2]).toThrow()
  })
  it.each(['scope', 'stop'] as const)('%s after the first result prevents Flux fallback and persistence', async mode => {
    vi.mocked(generateImage).mockImplementationOnce(async () => {
      if (mode === 'stop') controller.abort(); else valid = false
      return { ok: false, code: 'unavailable' }
    })
    await expect(handler({ prompt: 'photo paysage' }, context)).rejects.toMatchObject({ name: 'AbortError' })
    expect(generateImage).toHaveBeenCalledOnce(); expect(putFile).not.toHaveBeenCalled()
  })
  it('permits the existing fallback only with the same current capability', async () => {
    vi.mocked(generateImage).mockResolvedValueOnce({ ok: false, code: 'unavailable' })
    await handler({ prompt: 'photo paysage' }, context)
    expect(vi.mocked(generateImage).mock.calls.map(c => c[1])).toEqual(['flux', 'openai'])
    expect(vi.mocked(generateImage).mock.calls[0][2]).toBe(vi.mocked(generateImage).mock.calls[1][2])
  })
  it('does not retry an ambiguous failure that may already be billed', async () => {
    vi.mocked(generateImage).mockResolvedValueOnce({ ok: false, code: 'failed' })
    await handler({ prompt: 'photo paysage' }, context)
    expect(generateImage).toHaveBeenCalledOnce(); expect(putFile).not.toHaveBeenCalled()
  })
  it('does not return data after the storage boundary is invalidated', async () => {
    vi.mocked(putFile).mockImplementation(async (_file, owner, guard) => { expect(owner).toBe('a'); valid = false; guard?.(); return 'image' })
    await expect(handler({ prompt: 'logo' }, context)).rejects.toMatchObject({ name: 'AbortError' })
  })
  it.each([1, 2, 3])('preserves durable-only cancellation at fence check %i', async boundary => {
    let checks = 0
    vi.mocked(assertProjectOperation).mockImplementation(async () => { if (++checks === boundary) throw new ProjectError('cancelled') })
    // generateImage is mocked here: checks are post-response, pre-put, post-put.
    await expect(handler({ prompt: 'logo' }, context)).rejects.toMatchObject({ code: 'cancelled' })
    expect(putFile).toHaveBeenCalledTimes(boundary === 3 ? 1 : 0)
  })
})
