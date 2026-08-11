import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveProxyIdentityDetailed,
} from '../../../functions/api/_lib/emailTrial'
import { onRequestPost as anthropicProxy } from '../../../functions/api/ai/proxy'
import { onRequestPost as ttsProxy } from '../../../functions/api/ai/tts'
import { onRequestPost as contentReport } from '../../../functions/api/report/index'
import { onRequestGet as subscriptionStatus } from '../../../functions/api/subscription/status'

const ENV = { GOOGLE_CLIENT_ID: 'arty-client-id' } as never

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('proxy identity — contrat Google explicite et fail-closed', () => {
  it('ne transmet jamais un Bearer BYOK à Google quand x-google-token manque', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const request = new Request('https://tryarty.com/api/ai/gemini-proxy', {
      method: 'POST',
      headers: { Authorization: 'Bearer gemini-byok-secret' },
    })

    expect(await resolveProxyIdentityDetailed(request, ENV)).toEqual({ status: 'unauthorized' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('un tokeninfo valide suffit : même email vérifié, aucun second userinfo', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      email: 'Owner@Example.com',
      email_verified: true,
      aud: 'arty-client-id',
      user_id: 'google-sub-1',
    })))
    vi.stubGlobal('fetch', fetchSpy)
    const request = new Request('https://tryarty.com/api/ai/proxy', {
      headers: { 'x-google-token': 'google-token' },
    })

    expect(await resolveProxyIdentityDetailed(request, ENV)).toEqual({
      status: 'ok',
      identity: { kind: 'google', email: 'owner@example.com' },
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/tokeninfo')
  })

  it('la même preuve tokeninfo donne VIP au status et une identité au proxy', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/tokeninfo')) {
        return Response.json({
          email: 'vip@example.com',
          email_verified: true,
          aud: 'arty-client-id',
          sub: 'google-sub',
        })
      }
      throw new Error(`userinfo ne doit plus être appelé: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)
    const env = {
      GOOGLE_CLIENT_ID: 'arty-client-id',
      ALLOWED_EMAILS: 'vip@example.com',
    } as never

    const statusResponse = await subscriptionStatus({
      request: new Request('https://tryarty.com/api/subscription/status', {
        headers: { Authorization: 'Bearer google-token' },
      }),
      env,
    } as never)
    expect(await statusResponse.json()).toMatchObject({ auth: 'ok', plan: 'vip' })

    const identity = await resolveProxyIdentityDetailed(new Request(
      'https://tryarty.com/api/ai/proxy',
      { headers: { 'x-google-token': 'google-token' } },
    ), env)
    expect(identity).toEqual({
      status: 'ok',
      identity: { kind: 'google', email: 'vip@example.com' },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls.every(([input]) => String(input).includes('/tokeninfo'))).toBe(true)
  })

  it('x-google-token rejeté ne bascule pas sur un jeton email-trial', async () => {
    const prepare = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
    const request = new Request('https://tryarty.com/api/ai/proxy', {
      headers: {
        'x-google-token': 'rejected-google',
        'x-arty-trial-token': 'valid-or-not-the-path-must-not-be-read',
      },
    })

    const result = await resolveProxyIdentityDetailed(request, {
      GOOGLE_CLIENT_ID: 'arty-client-id',
      DB: { prepare } as unknown as D1Database,
    } as never)
    expect(result).toEqual({ status: 'unauthorized' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('x-google-token vide ne bascule pas non plus sur un jeton email-trial', async () => {
    const prepare = vi.fn()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const request = new Request('https://tryarty.com/api/ai/proxy', {
      headers: {
        'x-google-token': ' ',
        'x-arty-trial-token': 'must-not-be-read',
      },
    })

    const result = await resolveProxyIdentityDetailed(request, {
      GOOGLE_CLIENT_ID: 'arty-client-id',
      DB: { prepare } as unknown as D1Database,
    } as never)
    expect(result).toEqual({ status: 'unauthorized' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('panne tokeninfo devient 503, pas une fausse demande de reconnexion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    const response = await anthropicProxy({
      request: new Request('https://tryarty.com/api/ai/proxy', {
        method: 'POST',
        headers: { 'x-google-token': 'google-token' },
        body: '{}',
      }),
      env: ENV,
      waitUntil: vi.fn(),
    } as never)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Authentication service temporarily unavailable' })
  })

  it('les proxys auxiliaires distinguent aussi une panne Google d’un token rejeté', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))

    const ttsResponse = await ttsProxy({
      request: new Request('https://tryarty.com/api/ai/tts', {
        method: 'POST',
        headers: { 'x-google-token': 'google-token' },
        body: '{}',
      }),
      env: ENV,
      waitUntil: vi.fn(),
    } as never)
    expect(ttsResponse.status).toBe(503)

    const reportResponse = await contentReport({
      request: new Request('https://tryarty.com/api/report', {
        method: 'POST',
        headers: { 'x-google-token': 'google-token' },
        body: '{}',
      }),
      env: ENV,
    } as never)
    expect(reportResponse.status).toBe(503)
  })

  it('un Bearer BYOK seul n’est jamais interprété comme token Google par TTS', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const response = await ttsProxy({
      request: new Request('https://tryarty.com/api/ai/tts', {
        method: 'POST',
        headers: { Authorization: 'Bearer openai-byok-secret' },
        body: '{}',
      }),
      env: ENV,
      waitUntil: vi.fn(),
    } as never)

    expect(response.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
