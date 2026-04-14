import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(),
}))
vi.mock('../../services/apiBase', () => ({
  apiUrl: (path: string) => path,
}))

import * as gmail from '../../services/gmailClient'
import { getValidAccessToken } from '../../services/googleAuth'

const mockGetToken = vi.mocked(getValidAccessToken)

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
  } as unknown as Response
  global.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch
  return global.fetch as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetToken.mockResolvedValue('fresh-token')
})

describe('gmailClient', () => {
  it('listUnreadEmails sends type:list and returns messages', async () => {
    const fetchMock = mockFetch({ messages: [{ id: '1', subject: 's' }] })
    const res = await gmail.listUnreadEmails()
    expect(res).toEqual([{ id: '1', subject: 's' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/gmail/action', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
    }))
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ type: 'list' })
  })

  it('throws "Non connecté" when no token', async () => {
    mockGetToken.mockResolvedValue(null)
    await expect(gmail.listUnreadEmails()).rejects.toThrow(/connecté/i)
  })

  it('readEmail sends type:read with id', async () => {
    const fetchMock = mockFetch({ id: 'x', body: 'content', from: 'a', to: 'b', subject: 's', date: 'd', threadId: 't', snippet: 'sn' })
    const res = await gmail.readEmail('x')
    expect(res.body).toBe('content')
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ type: 'read', id: 'x' })
  })

  it('sendEmail returns id + threadId', async () => {
    const fetchMock = mockFetch({ id: 'm1', threadId: 't1' })
    const res = await gmail.sendEmail({ to: 'x@y', subject: 's', body: 'b' })
    expect(res).toEqual({ id: 'm1', threadId: 't1' })
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ type: 'send', to: 'x@y', subject: 's', body: 'b' })
  })

  it('throws server error when !res.ok', async () => {
    mockFetch({ error: 'Quota exceeded' }, { ok: false, status: 429 })
    await expect(gmail.listUnreadEmails()).rejects.toThrow(/Quota exceeded/i)
  })
})
