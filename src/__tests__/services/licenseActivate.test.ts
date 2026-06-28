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

// L'activation valide UNIQUEMENT la paire secrète (license_key, email) en D1.
// Pas de gate token Google : il était contournable par omission du header, et
// rejetait à tort les users sans Google (apikey/email-OTP) ou activant une
// licence achetée sous un autre email. Aucun risque financier (Pro=BYOK, #287).
describe('license/activate — validation par paire (license_key, email)', () => {
  it('SANS token : active via la paire — tous modes de login', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { success?: boolean }).success).toBe(true)
  })

  it('AVEC un header token (même non vérifié) : ignoré, aucun appel réseau, active', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    const res = await call({ 'x-google-token': 'peu-importe' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { success?: boolean }).success).toBe(true)
    // Preuve que le gate token est retiré : tokeninfo (ou tout fetch) jamais appelé.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('paire inconnue (license/email ne matchent pas) : rejet 404 uniforme', async () => {
    const db = makeDB()
    // Force le SELECT à ne rien renvoyer (licence absente pour cette paire).
    db.prepare = (() => ({
      bind: () => ({
        async first() {
          return null
        },
        async run() {
          return { success: true, meta: { changes: 0 } }
        },
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any
    const res = await onRequestPost({
      request: makeRequest(),
      env: { DB: db, GOOGLE_CLIENT_ID: 'CID' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    expect(res.status).toBe(404)
  })
})
