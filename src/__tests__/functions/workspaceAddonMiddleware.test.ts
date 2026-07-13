import { describe, expect, it, vi } from 'vitest'
import { onRequest, WORKSPACE_ADDON_POST_PATHS } from '../../../functions/api/_middleware'

let nextIp = 1

function request(path: string, method = 'POST', origin?: string): Request {
  const headers = new Headers({
    'cf-connecting-ip': `198.51.100.${nextIp++}`,
  })
  if (origin !== undefined) headers.set('Origin', origin)

  return new Request(`https://tryarty.com${path}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
  })
}

async function runMiddleware(
  req: Request,
  handlerResponse = new Response('handler reached', { status: 200 })
) {
  const next = vi.fn(async () => handlerResponse)
  const response = await onRequest({ request: req, next } as never)
  return { response, next }
}

describe('Workspace Add-on Origin exception', () => {
  it('lets an Origin-less POST under the exact prefix reach the OIDC handler without granting auth', async () => {
    const { response, next } = await runMiddleware(
      request('/api/workspace-addon/phase0/home'),
      Response.json({ error: 'invalid_oidc' }, { status: 401 })
    )

    expect(next).toHaveBeenCalledOnce()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_oidc' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('allows only the four exact Phase 0 paths, never the namespace root', async () => {
    expect([...WORKSPACE_ADDON_POST_PATHS].sort()).toEqual([
      '/api/workspace-addon/phase0/context',
      '/api/workspace-addon/phase0/create-draft',
      '/api/workspace-addon/phase0/home',
      '/api/workspace-addon/phase0/read',
    ])
    for (const path of WORKSPACE_ADDON_POST_PATHS) {
      const allowed = await runMiddleware(request(path))
      expect(allowed.next).toHaveBeenCalledOnce()
      expect(allowed.response.status).toBe(200)
    }
    const rejected = await runMiddleware(request('/api/workspace-addon/'))
    expect(rejected.next).not.toHaveBeenCalled()
    expect(rejected.response.status).toBe(403)
  })

  it('rejects an unregistered route inside the Workspace Add-on namespace', async () => {
    const { response, next } = await runMiddleware(request('/api/workspace-addon/ai/analyze'))

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
  })

  it('does not match a lookalike workspace-addon-evil path', async () => {
    const { response, next } = await runMiddleware(request('/api/workspace-addon-evil/phase0/home'))

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
  })

  it.each(['GET', 'PUT', 'OPTIONS'])(
    'does not extend the missing-Origin exception to %s',
    async (method) => {
      const { response, next } = await runMiddleware(
        request('/api/workspace-addon/phase0/home', method)
      )

      expect(next).not.toHaveBeenCalled()
      expect(response.status).toBe(403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
  )

  it.each(['https://tryarty.com', 'https://attacker.example'])(
    'rejects every Origin on Workspace Add-on POSTs without ACAO (%s)',
    async (origin) => {
      const { response, next } = await runMiddleware(
        request('/api/workspace-addon/phase0/home', 'POST', origin)
      )

      expect(next).not.toHaveBeenCalled()
      expect(response.status).toBe(403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    }
  )

  it('rejects an explicitly supplied empty Origin header', async () => {
    const req = request('/api/workspace-addon/phase0/home')
    req.headers.set('Origin', '')
    const { response, next } = await runMiddleware(req)

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
  })
})

describe('existing middleware behavior outside Workspace Add-on routes', () => {
  it('still allows an authorized browser Origin and returns ACAO', async () => {
    const { response, next } = await runMiddleware(
      request('/api/auth/token', 'POST', 'https://tryarty.com')
    )

    expect(next).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://tryarty.com')
  })

  it('still rejects an Origin-less browser POST', async () => {
    const { response, next } = await runMiddleware(request('/api/auth/token'))

    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(403)
  })

  it('still lets an Origin-less webhook reach its signature-verifying handler', async () => {
    const { response, next } = await runMiddleware(
      request('/api/webhook/lemonsqueezy'),
      Response.json({ error: 'invalid_signature' }, { status: 401 })
    )

    expect(next).toHaveBeenCalledOnce()
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_signature' })
  })
})
