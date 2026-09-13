import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ owner: 'A', epoch: 1, grant: 1 }))
vi.mock('../../services/userSession', () => ({ getActiveUserId: () => state.owner, getActiveSessionEpoch: () => state.epoch }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(), captureGoogleGrant: () => {
  const epoch = state.grant
  return { isCurrent: () => epoch === state.grant, getAccessToken: () => getValidAccessToken() }
} }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (url: string) => url }))
vi.mock('../../services/memoryHistory', () => ({ logChange: vi.fn() }))
import { getValidAccessToken } from '../../services/googleAuth'
import { updateMemory } from '../../services/memoryService'
import { logChange } from '../../services/memoryHistory'
const fetchMock = vi.fn()
beforeEach(() => { vi.clearAllMocks(); state.owner = 'A'; state.epoch = 1; state.grant = 1; vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

describe('memory write authority', () => {
  it.each(['stop', 'account', 'grant'])('does not write if %s happens while the write token is pending', async cause => {
    let release!: (token: string) => void
    vi.mocked(getValidAccessToken).mockResolvedValueOnce('token-A')
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: ['old'] })))
    const controller = new AbortController()
    const result = updateMemory('notes', ['old', 'new'], { signal: controller.signal, assertCurrent() {} })
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(getValidAccessToken).toHaveBeenCalledTimes(2))
    if (cause === 'stop') controller.abort()
    else if (cause === 'grant') state.grant++
    else { state.owner = 'B'; state.epoch++ }
    release('token-B')
    await rejected
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).type).toBe('read')
    expect(logChange).not.toHaveBeenCalled()
  })
  it('does not overwrite after the previous category failed to load', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('token-A')
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    expect((await updateMemory('notes', ['new'])).success).toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('writes and records undo under the same owner', async () => {
    vi.mocked(getValidAccessToken).mockResolvedValue('token-A')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: ['old'] })))
      .mockResolvedValueOnce(new Response('{}'))
    expect((await updateMemory('notes', ['old', 'new'])).success).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ type: 'write', userId: 'A', data: ['old', 'new'] })
    expect(logChange).toHaveBeenCalledWith('notes', 'Mise à jour', '2 entrée(s)', ['old'])
  })
})
