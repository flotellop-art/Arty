import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  canonicalRedirect,
  LEGACY_PUBLIC_HOSTS,
  onRequest,
} from '../../../functions/_middleware'

describe('canonical origin middleware', () => {
  it.each([
    'appfacade.pages.dev',
    'www.tryarty.com',
  ])('redirige définitivement les pages de %s vers tryarty.com', (host) => {
    const response = canonicalRedirect(new Request(`https://${host}/chat?id=42`))

    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('https://tryarty.com/chat?id=42')
  })

  it('ne redirige pas le domaine canonique ni les previews Pages', () => {
    expect(canonicalRedirect(new Request('https://tryarty.com/chat'))).toBeNull()
    expect(canonicalRedirect(new Request('https://branch.appfacade.pages.dev/chat'))).toBeNull()
  })

  it('ne transforme jamais un chemin à double slash en redirection externe', () => {
    const response = canonicalRedirect(
      new Request('https://appfacade.pages.dev//attacker.example/phishing?x=1'),
    )

    expect(response?.headers.get('location'))
      .toBe('https://tryarty.com//attacker.example/phishing?x=1')
  })

  it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])('laisse le transport API historique à next, méthode %s', (method) => {
    const response = canonicalRedirect(
      new Request('https://appfacade.pages.dev/api/subscription/status/?id=42', { method }),
    )
    expect(response).toBeNull()
  })

  it.each(['/api', '/api/'])('laisse %s à next sans garantir un handler', async (path) => {
    const next = vi.fn(async () => new Response('not found', { status: 404 }))
    const response = await onRequest({
      request: new Request(`https://appfacade.pages.dev${path}`), next,
    } as never)
    expect(next).toHaveBeenCalledOnce()
    expect(response.status).toBe(404)
  })

  it.each(['/apiary', '/API/calendar/action', '/api%2Fcalendar/action', '/api%252Fcalendar/action', '//api/calendar/action'])('ne traite pas %s comme le segment API', (path) => {
    const response = canonicalRedirect(new Request(`https://appfacade.pages.dev${path}`))
    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe(`https://tryarty.com${path}`)
  })

  it('conserve la politique www, y compris ses API', () => {
    const response = canonicalRedirect(new Request('https://www.tryarty.com/api/calendar/action?x=1', { method: 'POST' }))
    expect(response?.status).toBe(308)
    expect(response?.headers.get('location')).toBe('https://tryarty.com/api/calendar/action?x=1')
  })

  it.each(['/api/webhook/creem', '/api/webhook/lemonsqueezy'])('laisse le webhook signé %s sur appfacade', (path) => {
    expect(canonicalRedirect(new Request(`https://appfacade.pages.dev${path}`))).toBeNull()
    expect(canonicalRedirect(new Request(`https://appfacade.pages.dev${path}/`))).toBeNull()
  })

  it('appelle le handler suivant sur tryarty et sur un webhook de transition', async () => {
    const next = vi.fn(async () => new Response('ok'))
    const canonical = await onRequest({
      request: new Request('https://tryarty.com/'),
      next,
    } as never)
    const compat = await onRequest({
      request: new Request('https://appfacade.pages.dev/api/webhook/creem', { method: 'POST' }),
      next,
    } as never)

    expect(await canonical.text()).toBe('ok')
    expect(await compat.text()).toBe('ok')
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('garde une liste explicite sans englober les previews', () => {
    expect(LEGACY_PUBLIC_HOSTS.has('appfacade.pages.dev')).toBe(true)
    expect(LEGACY_PUBLIC_HOSTS.has('branch.appfacade.pages.dev')).toBe(false)
    expect(LEGACY_PUBLIC_HOSTS.has('arty.pages.dev')).toBe(false)
  })

  it('exclut les assets statiques du quota Pages Functions, jamais les API', () => {
    const routes = JSON.parse(readFileSync(
      join(process.cwd(), 'public', '_routes.json'),
      'utf8',
    )) as { version: number; include: string[]; exclude: string[] }

    expect(routes).toEqual(expect.objectContaining({ version: 1, include: ['/*'] }))
    expect(routes.exclude).toEqual(expect.arrayContaining([
      '/assets/*',
      '/icons/*',
      '/sw.js',
      '/sw-register.js',
    ]))
    expect(routes.exclude.some((route) => route.startsWith('/api'))).toBe(false)
  })
})
