// `/api/subscription/status` renvoyait « Free » en HTTP 200 pour trois
// situations indiscernables : pas de token, token refusé, et vrai compte
// gratuit. Un compte VIP dont le token est rejeté voyait donc « Gratuit »
// sans le moindre indice — terrain du 10 août 2026, même cécité que BUG 64.
// Ces tests verrouillent la distinction.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { onRequestGet } from '../../../functions/api/subscription/status'

const ORIGINAL_FETCH = global.fetch
afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

const ENV = {
  GOOGLE_CLIENT_ID: 'arty-client-id',
  ALLOWED_EMAILS: 'vip@example.com',
} as never

function call(headers: Record<string, string> = {}) {
  const request = new Request('https://tryarty.com/api/subscription/status', { headers })
  return onRequestGet({ request, env: ENV } as never) as Promise<Response>
}

function tokeninfo(body: object, ok = true) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 401 })) as typeof fetch
}

describe('subscription/status — pourquoi ce plan', () => {
  it('sans token : auth = no_token', async () => {
    const body = await (await call()).json() as { auth: string; plan: string }
    expect(body.auth).toBe('no_token')
    expect(body.plan).toBe('free')
  })

  it('token émis pour une AUTRE application : auth = token_rejected, pas un faux « gratuit »', async () => {
    tokeninfo({ email: 'vip@example.com', email_verified: 'true', aud: 'une-autre-app' })
    const body = await (await call({ Authorization: 'Bearer t' })).json() as { auth: string; plan: string; email: string }
    expect(body.auth).toBe('token_rejected')
    expect(body.plan).toBe('free')
    // L'e-mail reste vide : rien n'a été prouvé, on n'affirme rien.
    expect(body.email).toBe('')
  })

  it('Google indisponible : auth = token_rejected (l\'échec ne se déguise pas en gratuit)', async () => {
    tokeninfo({}, false)
    const body = await (await call({ Authorization: 'Bearer t' })).json() as { auth: string }
    expect(body.auth).toBe('token_rejected')
  })

  it('e-mail non vérifié : refusé, pas silencieusement gratuit', async () => {
    tokeninfo({ email: 'vip@example.com', email_verified: 'false', aud: 'arty-client-id' })
    const body = await (await call({ Authorization: 'Bearer t' })).json() as { auth: string }
    expect(body.auth).toBe('token_rejected')
  })

  it('token valide + e-mail dans ALLOWED_EMAILS : VIP avec auth = ok', async () => {
    tokeninfo({ email: 'vip@example.com', email_verified: 'true', aud: 'arty-client-id' })
    const body = await (await call({ Authorization: 'Bearer t' })).json() as {
      auth: string; plan: string; email: string; allowed_families: string[]
    }
    expect(body.auth).toBe('ok')
    expect(body.plan).toBe('vip')
    expect(body.email).toBe('vip@example.com')
    expect(body.allowed_families.length).toBeGreaterThan(1)
  })

  it('token valide hors whitelist : vrai gratuit, et il le DIT (auth = ok)', async () => {
    tokeninfo({ email: 'autre@example.com', email_verified: 'true', aud: 'arty-client-id' })
    const body = await (await call({ Authorization: 'Bearer t' })).json() as { auth: string; plan: string; email: string }
    // Distinction centrale : ce gratuit-là est établi, l'autre était un repli.
    expect(body.auth).toBe('ok')
    expect(body.plan).toBe('free')
    expect(body.email).toBe('autre@example.com')
  })

  it('le token accepté par `azp` (flux natif) passe aussi', async () => {
    tokeninfo({ email: 'vip@example.com', email_verified: true, azp: 'arty-client-id' })
    const body = await (await call({ Authorization: 'Bearer t' })).json() as { auth: string; plan: string }
    expect(body.auth).toBe('ok')
    expect(body.plan).toBe('vip')
  })
})
