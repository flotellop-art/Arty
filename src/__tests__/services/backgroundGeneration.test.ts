import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), addListener: vi.fn() }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => native }))
vi.mock('../../services/native/platform', () => ({ platform: 'android' }))
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
const pending = () => {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks()
  native.acquire.mockResolvedValue(undefined)
  native.release.mockResolvedValue(undefined)
  native.addListener.mockResolvedValue({ remove: vi.fn() })
})

describe('Android generation leases', () => {
  it('waits for actual native promotion before allowing a provider request', async () => {
    const promotion = pending(); native.acquire.mockReturnValue(promotion.promise)
    const { acquireGeneration } = await import('../../services/native/generation')
    const lease = acquireGeneration(vi.fn()), request = vi.fn()
    const sending = lease.ready.then(request)
    await vi.waitFor(() => expect(native.acquire).toHaveBeenCalledTimes(1))
    expect(request).not.toHaveBeenCalled()
    promotion.resolve(); await sending
    expect(request).toHaveBeenCalledTimes(1)
    lease.release(); lease.release()
    expect(native.release).toHaveBeenCalledTimes(1)
  })
  it('Stop before native acknowledgement releases the late token without sending', async () => {
    const promotion = pending(); native.acquire.mockReturnValue(promotion.promise)
    const { acquireGeneration } = await import('../../services/native/generation')
    const lease = acquireGeneration(vi.fn()), request = vi.fn()
    const sending = lease.ready.then(request)
    const rejection = expect(sending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(native.acquire).toHaveBeenCalledTimes(1))
    lease.release(); promotion.resolve(); await rejection
    expect(request).not.toHaveBeenCalled()
    expect(native.release).toHaveBeenCalledExactlyOnceWith(native.acquire.mock.calls[0]![0])
  })
  it('refusal does not dispatch or retry a paid request', async () => {
    native.acquire.mockRejectedValue(new Error('ForegroundServiceStartNotAllowedException'))
    const { acquireGeneration } = await import('../../services/native/generation')
    const lease = acquireGeneration(vi.fn()), request = vi.fn()
    await expect(lease.ready.then(request)).rejects.toThrow('errors.backgroundGenerationUnavailable')
    lease.release()
    expect(request).not.toHaveBeenCalled(); expect(native.acquire).toHaveBeenCalledTimes(1)
  })
  it('concurrent generations and stale completion own distinct native tokens', async () => {
    const { acquireGeneration } = await import('../../services/native/generation')
    const expiredA = vi.fn(), expiredB = vi.fn()
    const a = acquireGeneration(expiredA), b = acquireGeneration(expiredB)
    await Promise.all([a.ready, b.ready])
    const tokenA = native.acquire.mock.calls[0]![0], tokenB = native.acquire.mock.calls[1]![0]
    expect(tokenA).not.toEqual(tokenB)
    a.release()
    expect(native.release).toHaveBeenCalledExactlyOnceWith(tokenA)
    native.addListener.mock.calls[0]![1](tokenA)
    expect(expiredA).not.toHaveBeenCalled(); expect(expiredB).not.toHaveBeenCalled()
    native.addListener.mock.calls[0]![1](tokenB)
    expect(expiredB).toHaveBeenCalledTimes(1)
    b.release(); expect(native.release).toHaveBeenLastCalledWith(tokenB)
  })

  it('verification retains the already running service without a background restart', async () => {
    const { acquireGeneration } = await import('../../services/native/generation')
    const lease = acquireGeneration(vi.fn())
    await lease.ready
    const finishVerification = lease.retain()
    lease.release(); lease.release()
    expect(native.release).not.toHaveBeenCalled()
    expect(native.acquire).toHaveBeenCalledTimes(1)
    finishVerification(); finishVerification()
    expect(native.release).toHaveBeenCalledTimes(1)
  })
})
