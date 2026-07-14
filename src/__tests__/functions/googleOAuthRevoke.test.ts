import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/auth/revoke'

function request(body: string, options: { origin?: string; contentType?: string } = {}): Request {
  return new Request('https://tryarty.com/api/auth/revoke', {
    method: 'POST',
    headers: {
      'content-type': options.contentType || 'application/json',
      origin: options.origin || 'https://tryarty.com',
    },
    body,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OAuth Google — bridge de révocation same-origin', () => {
  it('révoque côté serveur sans exposer le jeton dans l’URL', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await onRequestPost({
      request: request(JSON.stringify({ token: 'refresh-secret' })),
    } as never)

    expect(response.status).toBe(204)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/revoke',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      }),
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(String(init.body)).toBe('token=refresh-secret')
  })

  it('renvoie 502 lorsque Google refuse la révocation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    const response = await onRequestPost({
      request: request(JSON.stringify({ token: 'refresh-secret' })),
    } as never)
    expect(response.status).toBe(502)
  })

  it.each([
    ['JSON invalide', '{'],
    ['jeton absent', '{}'],
    ['jeton trop long', JSON.stringify({ token: 'x'.repeat(8_193) })],
  ])('rejette %s sans appeler Google', async (_label, body) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await onRequestPost({ request: request(body) } as never)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['origine absente', { origin: '' }],
    ['origine étrangère', { origin: 'https://evil.example' }],
    ['contenu simple cross-origin', { contentType: 'text/plain' }],
  ])('refuse %s sans relayer le jeton', async (_label, options) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const req = request(JSON.stringify({ token: 'secret' }), options)
    if (options.origin === '') req.headers.delete('origin')
    const response = await onRequestPost({ request: req } as never)
    expect([403, 415]).toContain(response.status)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
