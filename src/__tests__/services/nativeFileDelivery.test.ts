import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ native: true, write: vi.fn(), share: vi.fn(), read: vi.fn(), mkdir: vi.fn(), remove: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: mock.write, readdir: mock.read, mkdir: mock.mkdir, deleteFile: mock.remove }, Directory: { Cache: 'CACHE' } }))
vi.mock('@capacitor/share', () => ({ Share: { share: mock.share } }))
import { downloadOrShareFile } from '../../services/native/shareFile'
let current: boolean
const guard = () => { if (!current) throw new Error('cancelled') }
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  vi.resetAllMocks(); current = true; mock.native = true
  mock.read.mockResolvedValue({ files: [] }); mock.mkdir.mockResolvedValue(undefined); mock.remove.mockResolvedValue(undefined)
  mock.write.mockResolvedValue({ uri: 'content://own-file' }); mock.share.mockResolvedValue({ activityType: '' })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('scoped native file delivery', () => {
  it('refuses a full 32-file cache visibly before write/share', async () => {
    mock.read.mockResolvedValue({ files: Array.from({ length: 32 }, () => ({ name: `${Date.now()}-${crypto.randomUUID()}.docx`, type: 'file' })) })
    await expect(downloadOrShareFile(new Blob(['one']), 'one.docx', { assertCurrent: guard })).rejects.toThrow(/32 exports/)
    expect(mock.write).not.toHaveBeenCalled(); expect(mock.share).not.toHaveBeenCalled()
  })
  it('durable validation can cancel after write without opening share', async () => {
    let validations = 0
    await expect(downloadOrShareFile(new Blob(['one']), 'one.docx', { assertCurrent: guard, validate: async () => { if (++validations === 3) throw new Error('erasing') } })).rejects.toThrow('erasing')
    expect(mock.write).toHaveBeenCalledTimes(1); expect(mock.share).not.toHaveBeenCalled(); expect(mock.remove).toHaveBeenCalledTimes(1)
  })
  it('uses UUID cache path with MIME extension, never user filename as path', async () => {
    await downloadOrShareFile(new Blob(['secret']), '../private.docx', { assertCurrent: guard })
    expect(mock.write.mock.calls[0][0]).toMatchObject({ directory: 'CACHE', recursive: true })
    expect(mock.write.mock.calls[0][0].path).toMatch(/^arty-exports-v1\/\d{13}-[0-9a-f-]{36}\.docx$/)
    expect(mock.share).toHaveBeenCalledWith(expect.objectContaining({ url: 'content://own-file' }))
    expect(mock.remove).not.toHaveBeenCalled()
  })
  it('cleans only its own file if the scope changes during writeFile', async () => {
    const write = deferred<{ uri: string }>(); mock.write.mockReturnValue(write.promise)
    const sending = downloadOrShareFile(new Blob(['secret']), 'test.xlsx', { assertCurrent: guard })
    const result = expect(sending).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(mock.write).toHaveBeenCalled())
    current = false; write.resolve({ uri: 'content://own-file' }); await result
    expect(mock.share).not.toHaveBeenCalled()
    expect(mock.remove).toHaveBeenCalledWith({ path: mock.write.mock.calls[0][0].path, directory: 'CACHE' })
  })
  it('does not delete immediately once the sharing boundary was crossed', async () => {
    mock.share.mockImplementation(async () => { current = false })
    await expect(downloadOrShareFile(new Blob(['secret']), 'test.xlsx', { assertCurrent: guard })).rejects.toThrow('cancelled')
    expect(mock.remove).not.toHaveBeenCalled()
  })
  it('checks cancellation after FileReader without writing', async () => {
    vi.stubGlobal('FileReader', class { result = 'data:;base64,c2VjcmV0'; onload?: () => void; readAsDataURL() { current = false; this.onload?.() } })
    await expect(downloadOrShareFile(new Blob(['secret']), 'test.docx', { assertCurrent: guard })).rejects.toThrow('cancelled')
    expect(mock.write).not.toHaveBeenCalled(); expect(mock.share).not.toHaveBeenCalled()
  })
  it('checks durable scope again after write and cleans uncertain failed writes', async () => {
    mock.write.mockRejectedValue(new Error('partial write'))
    await expect(downloadOrShareFile(new Blob(['secret']), 'test.docx', { assertCurrent: guard })).rejects.toThrow('partial write')
    expect(mock.remove).toHaveBeenCalledWith({ path: mock.write.mock.calls[0][0].path, directory: 'CACHE' })
  })
  it('refuses simultaneous legacy/Office native exports at 31 files', async () => {
    mock.read.mockResolvedValue({ files: Array.from({ length: 31 }, () => ({ name: `${Date.now()}-${crypto.randomUUID()}.xlsx`, type: 'file' })) })
    const write = deferred<{ uri: string }>(); mock.write.mockReturnValue(write.promise)
    const first = downloadOrShareFile(new Blob(['one']), 'one.docx', { assertCurrent: guard })
    await vi.waitFor(() => expect(mock.write).toHaveBeenCalled())
    await expect(downloadOrShareFile(new Blob(['two']), 'two.json')).rejects.toThrow(/déjà en cours/)
    write.resolve({ uri: 'content://one' }); await first
    expect(mock.write).toHaveBeenCalledTimes(1)
  })
  it('cleans only expired recognized files and refuses an unreadable inventory', async () => {
    const expired = `${Date.now() - 25 * 3600000}-${crypto.randomUUID()}.xlsx`
    mock.read.mockResolvedValue({ files: [{ name: expired, type: 'file' }, { name: 'user-file.txt', type: 'file' }] })
    await downloadOrShareFile(new Blob(['one']), 'one.docx', { assertCurrent: guard })
    expect(mock.remove).toHaveBeenCalledTimes(1); expect(mock.remove).toHaveBeenCalledWith({ path: `arty-exports-v1/${expired}`, directory: 'CACHE' })
    mock.write.mockClear(); mock.read.mockRejectedValue(new Error('unreadable'))
    await expect(downloadOrShareFile(new Blob(['one']), 'one.docx', { assertCurrent: guard })).rejects.toThrow('unreadable')
    expect(mock.write).not.toHaveBeenCalled()
  })
  it('web download is guarded after async validation, with no click on cancellation', async () => {
    mock.native = false
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await expect(downloadOrShareFile(new Blob(['one']), 'one.docx', { assertCurrent: guard, validate: async () => { current = false } })).rejects.toThrow('cancelled')
    expect(click).not.toHaveBeenCalled()
  })
})
