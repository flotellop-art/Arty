import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(),
}))
vi.mock('../../services/apiBase', () => ({
  apiUrl: (path: string) => path,
}))

import * as calendar from '../../services/calendarClient'
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

describe('calendarClient', () => {
  it('listEvents defaults to 7 days and returns events', async () => {
    const fetchMock = mockFetch({
      events: [{ id: 'e1', title: 'Chantier', start: '2026-04-15T09:00', end: '', location: '', description: '' }],
    })
    const res = await calendar.listEvents()
    expect(res).toHaveLength(1)
    expect(res[0]!.title).toBe('Chantier')
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ type: 'list', days: 7 })
  })

  it('listEvents passes custom days', async () => {
    const fetchMock = mockFetch({ events: [] })
    await calendar.listEvents(30)
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toMatchObject({ days: 30 })
  })

  it('createEvent returns id + title', async () => {
    const fetchMock = mockFetch({ id: 'new', title: 'Test', start: '2026-04-15T09:00', link: 'https://calendar/...' })
    const res = await calendar.createEvent({ title: 'Test', start: '2026-04-15T09:00', location: 'Paris' })
    expect(res.id).toBe('new')
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toMatchObject({
      type: 'create', title: 'Test', start: '2026-04-15T09:00', location: 'Paris',
    })
  })

  it('updateEvent passes eventId and updates', async () => {
    const fetchMock = mockFetch({ success: true, title: 'Updated' })
    await calendar.updateEvent('ev-1', { title: 'Updated', location: 'Lyon' })
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({
      type: 'update', eventId: 'ev-1', title: 'Updated', location: 'Lyon',
    })
  })

  it('deleteEvent sends type:delete', async () => {
    const fetchMock = mockFetch({ success: true })
    const res = await calendar.deleteEvent('ev-1')
    expect(res.success).toBe(true)
    const call = fetchMock.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(call.body as string)).toEqual({ type: 'delete', eventId: 'ev-1' })
  })

  it('throws when not connected', async () => {
    mockGetToken.mockResolvedValue(null)
    await expect(calendar.listEvents()).rejects.toThrow(/connecté/i)
  })

  it('surfaces server error', async () => {
    mockFetch({ error: 'Rate limit' }, { ok: false, status: 429 })
    await expect(calendar.listEvents()).rejects.toThrow(/Rate limit/i)
  })
})
