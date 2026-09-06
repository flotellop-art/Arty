import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
const mock = vi.hoisted(() => ({ owner: 'a', epoch: 1, crypto: 1, begin: vi.fn(), fence: vi.fn(), get: vi.fn(), share: vi.fn(), guard: vi.fn() }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => mock.owner, getActiveSessionEpoch: () => mock.epoch }))
vi.mock('../../services/crypto', () => ({ captureCryptoGuard: () => { const generation = mock.crypto; return () => generation === mock.crypto } }))
vi.mock('../../services/projects/store', () => ({ beginProjectOperation: mock.begin, assertProjectOperation: mock.fence }))
vi.mock('../../services/storage', () => ({ getConversation: mock.get }))
vi.mock('../../services/native/shareFile', () => ({ downloadOrShareFile: mock.share }))
import { prepareOfficeExport, snapshotForExport } from '../../services/officeExport/session'
import { parseOfficeExport } from '../../services/officeExport/parse'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  calls: any[] = []
  terminate = vi.fn()
  constructor(public url: URL, public options: object) { FakeWorker.instances.push(this) }
  postMessage(data: unknown) { this.calls.push(data) }
  respond() {
    const req = this.calls.at(-1)
    this.onmessage?.({ data: req.kind === 'parse' ? { id: req.id, document: parseOfficeExport(req.snapshot) } : { id: req.id, buffer: new ArrayBuffer(8) } })
  }
}
let conv: Conversation, controllers: AbortController[]
function start() { const c = new AbortController(); controllers.push(c); return { promise: prepareOfficeExport(conv, undefined, c.signal), controller: c } }
async function ready() { const opened = start(); await vi.waitFor(() => expect(FakeWorker.instances.length).toBeGreaterThan(0)); FakeWorker.instances.at(-1)!.respond(); return { ...opened, session: await opened.promise } }
beforeEach(() => {
  vi.clearAllMocks(); controllers = []; FakeWorker.instances = []
  mock.owner = 'a'; mock.epoch = 1; mock.crypto = 1
  mock.guard.mockImplementation(() => {}); mock.begin.mockResolvedValue({ assertCurrent: mock.guard }); mock.fence.mockResolvedValue(undefined)
  conv = { id: 'c1', title: 'Test', createdAt: 1, updatedAt: 1, messages: [{ id: 'm1', role: 'assistant', content: 'Été', timestamp: 1 }] }
  mock.get.mockImplementation(() => conv); mock.share.mockResolvedValue(undefined)
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => { controllers.forEach(c => c.abort()); vi.unstubAllGlobals(); vi.useRealTimers() })
describe('export lifecycle: no AI, no late cross-account download', () => {
  it('snapshots an allowlist, never file bodies or live stream fragments', () => {
    conv.messages[0]!.files = [{ id: 'secret', name: 'secret.pdf', type: 'application/pdf', data: 'SECRETDATA' }]
    conv.messages.push({ id: 'streaming', role: 'assistant', content: 'live', timestamp: 2 })
    const value = snapshotForExport(conv)
    expect(value.messages).toHaveLength(1); expect(value.messages[0].attachments).toBe(1)
    expect(JSON.stringify(value)).not.toContain('SECRETDATA'); expect(JSON.stringify(value)).not.toContain('secret.pdf')
    expect(() => snapshotForExport(conv, 'streaming')).toThrow()
  })
  it.each(['owner', 'epoch', 'crypto'] as const)('refuses %s change while beginning the lease', async change => {
    mock.begin.mockImplementation(async () => { if (change === 'owner') mock.owner = 'b'; else mock[change]++; return { assertCurrent: mock.guard } })
    await expect(start().promise).rejects.toThrow(/session/)
    expect(FakeWorker.instances).toHaveLength(0)
  })
  it.each(['owner', 'epoch', 'crypto', 'delete', 'edit', 'fence', 'output-restriction'] as const)('refuses %s change during parse', async change => {
    const op = start(); const result = expect(op.promise).rejects.toThrow()
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    if (change === 'owner') mock.owner = 'b'
    if (change === 'epoch' || change === 'crypto') mock[change]++
    if (change === 'delete') mock.get.mockReturnValue(null)
    if (change === 'edit') conv.messages[0]!.content = 'Autre'
    if (change === 'fence') mock.guard.mockImplementation(() => { throw new Error('erasure') })
    if (change === 'output-restriction') conv.outputRestriction = 'client-reply-draft-v1'
    FakeWorker.instances[0]!.respond(); await result
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalled(); expect(mock.share).not.toHaveBeenCalled()
  })
  it('single concurrency, same-origin worker and abort release', async () => {
    const op = await ready()
    expect(FakeWorker.instances[0]!.url.pathname).toContain('/workers/officeExport.worker.ts')
    await expect(start().promise).rejects.toThrow(/autre export/)
    op.controller.abort()
    const next = start(); await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    FakeWorker.instances[1]!.respond(); (await next.promise).dispose()
  })
  it('terminates a slow parser at the deadline', async () => {
    vi.useFakeTimers()
    const op = start(), result = expect(op.promise).rejects.toThrow()
    await Promise.resolve(); await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10_001)
    await result; expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalled()
  })
  it('cancels after packing, before native/web delivery', async () => {
    const op = await ready()
    const sending = op.session.deliver({ format: 'docx', tableIds: [] }, vi.fn())
    const result = expect(sending).rejects.toThrow()
    mock.epoch++; FakeWorker.instances[0]!.respond(); await result
    expect(mock.share).not.toHaveBeenCalled()
  })
  it('checks durable fence after packing and passes a live lease through delivery', async () => {
    const op = await ready()
    mock.share.mockImplementation(async (_blob, filename, options) => {
      expect(filename).toBe('Test.docx'); options.assertCurrent(); await options.validate(); options.onEngaged()
    })
    const engaged = vi.fn(), sending = op.session.deliver({ format: 'docx', tableIds: [] }, engaged)
    FakeWorker.instances[0]!.respond(); await sending
    expect(mock.fence).toHaveBeenCalledTimes(2); expect(engaged).toHaveBeenCalledTimes(1)
  })
  it('blocks durable erasure without needing the source library to exist', async () => {
    const op = await ready()
    mock.fence.mockRejectedValue(new Error('erasing'))
    const sending = op.session.deliver({ format: 'xlsx', tableIds: ['table-1'] }, vi.fn())
    const result = expect(sending).rejects.toThrow('erasing')
    FakeWorker.instances[0]!.respond(); await result; expect(mock.share).not.toHaveBeenCalled()
  })
})
