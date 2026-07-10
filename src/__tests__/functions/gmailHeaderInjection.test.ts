import { beforeEach, describe, expect, it, vi } from 'vitest'

const googleFetchMock = vi.hoisted(() => vi.fn())

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({
  verifyGoogleUser: vi.fn(async () => 'owner@example.com'),
  notFoundResponse: () => Response.json({ error: 'Not found' }, { status: 404 }),
}))
vi.mock('../../../functions/api/_lib/googleFetch', () => ({ googleFetch: googleFetchMock }))

import { onRequestPost } from '../../../functions/api/gmail/action'

function call(body: Record<string, unknown>) {
  return onRequestPost({
    request: new Request('https://tryarty.com/api/gmail/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer google-token' },
      body: JSON.stringify(body),
    }),
  } as never)
}

describe('Gmail MIME header injection', () => {
  beforeEach(() => googleFetchMock.mockReset())

  it('rejects CRLF in send headers before any Gmail request', async () => {
    const res = await call({
      type: 'send',
      to: 'victim@example.com',
      subject: 'Bonjour\r\nBcc: attacker@example.com',
      body: 'contenu',
    })
    expect(res.status).toBe(400)
    expect(googleFetchMock).not.toHaveBeenCalled()
  })

  it('rejects NUL/CRLF in draft recipients before any Gmail request', async () => {
    const res = await call({
      type: 'draft',
      to: 'victim@example.com\0\r\nBcc: attacker@example.com',
      subject: 'Bonjour',
      body: 'contenu',
    })
    expect(res.status).toBe(400)
    expect(googleFetchMock).not.toHaveBeenCalled()
  })

  it('sends a valid message with exactly the confirmed recipient and subject', async () => {
    googleFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'message-1', threadId: 'thread-1' }), { status: 200 })
    )
    const res = await call({
      type: 'send', to: 'victim@example.com', subject: 'Compte rendu', body: 'contenu',
    })
    expect(res.status).toBe(200)
    const init = googleFetchMock.mock.calls[0]?.[1] as RequestInit
    const rawUrl = (JSON.parse(String(init.body)) as { raw: string }).raw
    const padded = rawUrl.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(rawUrl.length / 4) * 4, '=')
    const raw = Buffer.from(padded, 'base64').toString('utf8')
    expect(raw).toContain('To: victim@example.com\r\n')
    expect(raw).toContain('Subject: Compte rendu\r\n')
    expect(raw).not.toContain('Bcc:')
  })
})
