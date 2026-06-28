import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../../../functions/api/license/activate'

const VALID_BODY = {
  license_key: 'KEY-ABCD1234',
  email: 'buyer@example.com',
  device_id: '12345678-1234-1234-1234-123456789012',
}

// D1 minimal : SELECT renvoie une licence active, UPDATE/INSERT réussissent.
function makeDB() {
  const license = {
    ls_order_id: 'ord1',
    status: 'active',
    max_activations: 3,
    activation_count: 0,
  }
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async first() {
              return sql.includes('SELECT') ? license : null
            },
            async run() {
              return { success: true, meta: { changes: 1 } }
            },
          }
        },
      }
    },
  }
}

function makeRequest(headers: Record<string, string> = {}, body = VALID_BODY) {
  return new Request('https://tryarty.com/api/license/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function mockTokeninfo(payload: unknown, ok = true) {
  global.fetch = vi.fn(async (url: unknown) => {
    if (String(url).includes('tokeninfo')) {
      return { ok, status: ok ? 200 : 401, json: async () => payload } as unknown as Response
    }
    throw new Error('unexpected fetch: ' + String(url))
  }) as unknown as typeof fetch
}

const makeEnv = () => ({ DB: makeDB(), GOOGLE_CLIENT_ID: 'CID' })

let origFetch: typeof fetch
beforeEach(() => {
  origFetch = global.fetch
})
afterEach(() => {
  global.fetch = origFetch
  vi.restoreAllMocks()
})

async function call(headers: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return onRequestPost({ request: makeRequest(headers), env: makeEnv() } as any)
}

describe('license/activate — soft-require token Google', () => {
  it('SANS token : active via la paire (license_key, email) — users email/BYOK', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { success?: boolean }).success).toBe(true)
  })

  it('token valide + email correspondant : active', async () => {
    mockTokeninfo({ email: 'buyer@example.com', email_verified: 'true', aud: 'CID' })
    const res = await call({ 'x-google-token': 'tok' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { success?: boolean }).success).toBe(true)
  })

  it('token valide mais email DIFFÉRENT : rejet 404 (pas d’activation croisée)', async () => {
    mockTokeninfo({ email: 'someone-else@example.com', email_verified: 'true', aud: 'CID' })
    const res = await call({ 'x-google-token': 'tok' })
    expect(res.status).toBe(404)
  })

  it('token invalide (tokeninfo échoue) : rejet 404', async () => {
    mockTokeninfo({}, false)
    const res = await call({ 'x-google-token': 'tok' })
    expect(res.status).toBe(404)
  })

  it('token d’audience étrangère (aud ≠ GOOGLE_CLIENT_ID) : rejet 404', async () => {
    mockTokeninfo({ email: 'buyer@example.com', email_verified: 'true', aud: 'OTHER_APP' })
    const res = await call({ 'x-google-token': 'tok' })
    expect(res.status).toBe(404)
  })
})
