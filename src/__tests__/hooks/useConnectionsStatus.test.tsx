import { StrictMode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({
  read: vi.fn(), controller: new AbortController(), google: new Set<() => void>(), local: new Set<() => void>(),
}))
vi.mock('../../services/connectionsStatus', () => ({ readConnectionsSnapshot: f.read, connectionPlatform: () => 'web' }))
vi.mock('../../services/googleAuth', () => ({ onGoogleGrantInvalidated: (callback: () => void) => {
  f.google.add(callback); return () => { f.google.delete(callback) }
} }))
vi.mock('../../services/localDataInvalidation', () => ({ onLocalDataInvalidated: (callback: () => void) => {
  f.local.add(callback); return () => { f.local.delete(callback) }
} }))
vi.mock('../../services/workspaceWriter/runtime', () => ({ get documentWorkspaceSignal() { return f.controller.signal } }))
import { useConnectionsStatus } from '../../hooks/useConnectionsStatus'

const value = { platform: 'web', demo: false, session: 'apikey', google: 'not-configured', keys: [], mail: 'not-supported', mailCount: 0 }
beforeEach(() => {
  vi.restoreAllMocks(); f.read.mockReset(); f.google.clear(); f.local.clear(); f.controller = new AbortController()
  f.read.mockImplementation(async (signal: AbortSignal) => ({ snapshot: value, assertCurrent() { if (signal.aborted) throw new Error('retired') } }))
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected HTTP') }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Connections status view lifetime', () => {
  it('does not read, subscribe or act in a preview without private admission', async () => {
    const view = renderHook(() => useConnectionsStatus(false)), action = vi.fn()
    await act(async () => { await view.result.current.refresh(); view.result.current.act(action); window.dispatchEvent(new Event('focus')) })
    expect(f.read).not.toHaveBeenCalled(); expect(f.google.size).toBe(0); expect(f.local.size).toBe(0)
    expect(action).not.toHaveBeenCalled(); expect(view.result.current.snapshot).toBeNull()
  })

  it('mounts under StrictMode without any network or a surviving first receipt', async () => {
    const view = renderHook(() => useConnectionsStatus(), { wrapper: StrictMode })
    await waitFor(() => expect(view.result.current.state).toBe('ready'))
    expect(f.read).toHaveBeenCalledTimes(2)
    expect((f.read.mock.calls[0][0] as AbortSignal).aborted).toBe(true)
    expect((f.read.mock.calls[1][0] as AbortSignal).aborted).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    view.unmount(); expect(f.google.size).toBe(0); expect(f.local.size).toBe(0)
  })

  it('does not re-read or act through retained callbacks after unmount', async () => {
    const view = renderHook(() => useConnectionsStatus())
    await waitFor(() => expect(view.result.current.state).toBe('ready'))
    const old = view.result.current, action = vi.fn()
    view.unmount()
    await act(async () => { old.act(action); await old.refresh() })
    expect(action).not.toHaveBeenCalled(); expect(f.read).toHaveBeenCalledTimes(1)
  })

  it.each(['local', 'google'] as const)('revokes before queuing a read after %s invalidation', async source => {
    const view = renderHook(() => useConnectionsStatus())
    await waitFor(() => expect(view.result.current.state).toBe('ready'))
    const old = view.result.current, action = vi.fn()
    act(() => { for (const listener of f[source]) listener(); old.act(action) })
    expect(action).not.toHaveBeenCalled()
    await waitFor(() => expect(view.result.current.state).toBe('ready'))
    expect(view.result.current.snapshot).toEqual(value)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('removes private status immediately on terminal document loss and never refreshes it', async () => {
    const view = renderHook(() => useConnectionsStatus())
    await waitFor(() => expect(view.result.current.state).toBe('ready'))
    const old = view.result.current, action = vi.fn()
    await act(async () => {
      f.controller.abort()
      for (const listener of f.local) listener()
      old.act(action); await old.refresh()
    })
    expect(view.result.current.snapshot).toBeNull()
    expect(view.result.current.state).toBe('unavailable')
    expect((f.read.mock.calls[0][0] as AbortSignal).aborted).toBe(true)
    expect(action).not.toHaveBeenCalled(); expect(f.read).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending readonly admission on terminal document loss', async () => {
    let release!: (value: unknown) => void
    f.read.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const view = renderHook(() => useConnectionsStatus())
    act(() => { f.controller.abort() })
    expect((f.read.mock.calls[0][0] as AbortSignal).aborted).toBe(true)
    await act(async () => { release({ snapshot: value, assertCurrent() { throw new Error('retired') } }) })
    expect(view.result.current.snapshot).toBeNull(); expect(view.result.current.state).toBe('unavailable')
    expect(f.read).toHaveBeenCalledTimes(1)
  })

  it('shows unavailable without consulting an unadmitted session when reading fails', async () => {
    f.read.mockRejectedValue(new Error('document unavailable'))
    const view = renderHook(() => useConnectionsStatus())
    await waitFor(() => expect(view.result.current.state).toBe('unavailable'))
    expect(view.result.current.snapshot).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  })
})
