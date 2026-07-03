import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Audit F-5/F-7/F-22 (3 juil. 2026) — tests de la validation des entrées
// interpolées dans des URLs upstream (People API, REST WordPress). La
// baseline du projet (BUG 32) : tout ID venant du client est validé par
// regex/format strict AVANT interpolation. Ces tests appellent les vrais
// handlers avec l'auth mockée et un fetch espionné : une entrée malveillante
// doit être rejetée en 400 SANS qu'aucun appel upstream ne parte.

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({
  verifyGoogleUser: vi.fn(async () => 'owner@example.com'),
  parseAllowedEmails: (raw: string | undefined) =>
    raw ? raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) : [],
  notFoundResponse: () => Response.json({ error: 'Not found' }, { status: 404 }),
}))

import { onRequestPost as contactsPost } from '../../../functions/api/contacts/action'
import { onRequestPost as wordpressPost } from '../../../functions/api/wordpress/action'

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, id: 5, title: { rendered: 'T' }, status: 'draft' }), { status: 200 })
  )
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeContactsRequest(body: Record<string, unknown>): Request {
  return new Request('https://tryarty.com/api/contacts/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify(body),
  })
}

describe('contacts/action — validation resourceName (F-7)', () => {
  const call = (body: Record<string, unknown>) =>
    // Le handler n'utilise que { request } — contexte minimal suffisant.
    contactsPost({ request: makeContactsRequest(body) } as never)

  it("rejette en 400 un resourceName hors format people/<id> — pas d'appel upstream", async () => {
    for (const malicious of [
      'people/c123?x=1',              // query-string injection
      'people/c123/otherContacts',    // path traversal API
      'otherContacts/c123',           // autre collection People
      'people/../admin',              // dot segments
      'people/c123&pageSize=2000',    // paramètre injecté
    ]) {
      const res = await call({ type: 'update', resourceName: malicious, email: 'a@b.c' })
      expect(res.status, malicious).toBe(400)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('accepte un resourceName valide et appelle People API sur people/<id>', async () => {
    const res = await call({ type: 'update', resourceName: 'people/c1234567890', email: 'a@b.c' })
    expect(res.status).toBe(200)
    const firstUrl = String(fetchSpy.mock.calls[0]?.[0])
    expect(firstUrl).toContain('https://people.googleapis.com/v1/people/c1234567890?personFields=')
  })

  it('rejette resourceName manquant', async () => {
    const res = await call({ type: 'update', email: 'a@b.c' })
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('wordpress/action — validation postId (F-22)', () => {
  const env = {
    WP_URL: 'https://wp.example.com',
    WP_USERNAME: 'user',
    WP_PASSWORD: 'pass',
    WORDPRESS_OWNER_EMAILS: 'owner@example.com',
  }
  const call = (body: Record<string, unknown>) =>
    wordpressPost({
      request: new Request('https://tryarty.com/api/wordpress/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    } as never)

  it("rejette en 400 un postId non entier — pas d'appel upstream", async () => {
    for (const malicious of ['5/revisions', '5?force=true', 'abc', -3, 0, 1.5]) {
      const res = await call({ type: 'delete', postId: malicious })
      expect(res.status, String(malicious)).toBe(400)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('accepte un postId entier et construit une URL propre', async () => {
    const res = await call({ type: 'get', postId: 42 })
    expect(res.status).toBe(200)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://wp.example.com/wp-json/wp/v2/posts/42')
  })

  it('accepte un postId entier passé en string (tolérance JSON)', async () => {
    const res = await call({ type: 'get', postId: '42' })
    expect(res.status).toBe(200)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe('https://wp.example.com/wp-json/wp/v2/posts/42')
  })
})
