import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(),
}))
vi.mock('../../services/apiBase', () => ({
  apiUrl: (path: string) => path,
}))

import * as drive from '../../services/driveClient'
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

describe('driveClient', () => {
  it('listFiles sends folderId and query', async () => {
    const fetchMock = mockFetch({ files: [{ id: 'f1', name: 'a.pdf' }] })
    const res = await drive.listFiles('folder-x', 'name contains "report"')
    expect(res).toEqual([{ id: 'f1', name: 'a.pdf' }])
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({
      type: 'list',
      folderId: 'folder-x',
      q: 'name contains "report"',
    })
  })

  it('readFile returns content payload', async () => {
    mockFetch({ id: 'f', name: 'a', mimeType: 'text/plain', modifiedTime: 'd', content: 'hello' })
    const res = await drive.readFile('f')
    expect(res.content).toBe('hello')
  })

  it('createFile returns id + webViewLink', async () => {
    const fetchMock = mockFetch({ id: 'new', name: 'out.md', webViewLink: 'https://drive/...' })
    const res = await drive.createFile('out.md', 'body', { folderId: 'fx', mimeType: 'text/markdown' })
    expect(res.webViewLink).toContain('drive')
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({
      type: 'create', name: 'out.md', content: 'body', folderId: 'fx', mimeType: 'text/markdown',
    })
  })

  it('throws when not connected', async () => {
    mockGetToken.mockResolvedValue(null)
    await expect(drive.listFiles()).rejects.toThrow(/connecté/i)
  })

  it('surfaces server error', async () => {
    mockFetch({ error: 'Forbidden' }, { ok: false, status: 403 })
    await expect(drive.listFiles()).rejects.toThrow(/Forbidden/i)
  })
})
