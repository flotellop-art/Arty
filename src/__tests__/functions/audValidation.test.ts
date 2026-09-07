import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkAllowedUser,
  checkAllowedUserPeek,
} from '../../../functions/api/_lib/checkAllowedUser'
import type { Env } from '../../../functions/env'

// C1 / F-9 (audit 3 juil. 2026) — les chemins « peek » (checkAllowedUserPeek /
// checkAllowedUser) gardent des endpoints qui dépensent les clés owner
// (Linkup/Brave via search/web + fetch/url, quotas, météo, géo). Ils doivent
// désormais valider l'audience du token Google (aud/azp === GOOGLE_CLIENT_ID)
// pour rejeter un access_token valide mais émis pour une AUTRE app.
//
// Les codes natifs sont échangés côté serveur contre un access token dont
// l'audience est le client web Arty. Une audience absente ou invérifiable doit
// donc être rejetée sur les chemins qui dépensent les clés owner.

const CLIENT_ID = 'arty-web.apps.googleusercontent.com'
const OWNER_TOKEN = 'tok-abc'

function makeEnv(withReadableDb = true): Env {
  // Free is confirmed by successful reads with no subscription/license.
  // This fixture must never turn a missing DB into proof of eligibility.
  const prepare = vi.fn((sql: string) => {
    expect(sql).toMatch(/^SELECT (plan_type FROM subscriptions|1 AS ok FROM licenses)\s/)
    return { bind: (email: string) => {
      expect(email).toBe('user@gmail.com')
      return { first: async () => null }
    } }
  })
  return { GOOGLE_CLIENT_ID: CLIENT_ID, DB: withReadableDb ? { prepare } : undefined } as unknown as Env
}

function makeRequest(): Request {
  return new Request('https://tryarty.com/api/search/web', {
    method: 'POST',
    headers: { 'x-google-token': OWNER_TOKEN, 'content-type': 'application/json' },
    body: '{}',
  })
}

/**
 * Espionne les 2 fetch de verifyGoogleUser :
 *  - userinfo  → renvoie l'email
 *  - tokeninfo → renvoie l'audience simulée (ou une erreur)
 */
function stubGoogle(opts: {
  email?: string
  tokeninfo?: { aud?: string; azp?: string } | 'http_error' | 'network_error'
}) {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/oauth2/v2/userinfo')) {
      if (!opts.email) return new Response('', { status: 401 })
      return new Response(JSON.stringify({ email: opts.email, verified_email: true }), { status: 200 })
    }
    if (url.includes('/tokeninfo')) {
      if (opts.tokeninfo === 'network_error') throw new Error('boom')
      if (opts.tokeninfo === 'http_error') return new Response('', { status: 400 })
      return new Response(JSON.stringify({
        ...(opts.tokeninfo ?? {}),
        email: opts.email,
        email_verified: !!opts.email,
      }), { status: 200 })
    }
    throw new Error(`fetch inattendu: ${url}`)
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe('checkAllowedUserPeek — validation aud (C1/F-9)', () => {
  it('REJETTE (null) un token dont aud ET azp sont étrangers', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: 'evil-app.example', azp: 'evil-app.example' } })
    const env = makeEnv()
    expect(await checkAllowedUserPeek(makeRequest(), env)).toBeNull()
    expect(env.DB!.prepare).not.toHaveBeenCalled()
  })

  it('ACCEPTE un token dont aud === GOOGLE_CLIENT_ID', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: CLIENT_ID } })
    const r = await checkAllowedUserPeek(makeRequest(), makeEnv())
    expect(r).toEqual({ email: 'user@gmail.com', planType: 'free' })
  })

  it('ACCEPTE un token dont azp === GOOGLE_CLIENT_ID (aud différent)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: 'other', azp: CLIENT_ID } })
    const r = await checkAllowedUserPeek(makeRequest(), makeEnv())
    expect(r).toEqual({ email: 'user@gmail.com', planType: 'free' })
  })

  it('REJETTE un token sans aud/azp', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: {} })
    const env = makeEnv()
    expect(await checkAllowedUserPeek(makeRequest(), env)).toBeNull()
    expect(env.DB!.prepare).not.toHaveBeenCalled()
  })

  it('REJETTE sur tokeninfo KO (fail-closed)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: 'http_error' })
    expect(await checkAllowedUserPeek(makeRequest(), makeEnv())).toBeNull()
  })

  it('refuse (null) si aucun token Google (pas de header)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: CLIENT_ID } })
    const req = new Request('https://tryarty.com/api/search/web', { method: 'POST', body: '{}' })
    expect(await checkAllowedUserPeek(req, makeEnv())).toBeNull()
  })
})

describe('checkAllowedUser — validation aud (C1/F-9)', () => {
  it('REJETTE (null) un token à audience étrangère', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: 'evil-app.example', azp: 'evil-app.example' } })
    const env = makeEnv()
    expect(await checkAllowedUser(makeRequest(), env)).toBeNull()
    expect(env.DB!.prepare).not.toHaveBeenCalled()
  })

  it('ACCEPTE un token à audience Arty (Free confirmé par une DB lisible vide)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: CLIENT_ID } })
    const r = await checkAllowedUser(makeRequest(), makeEnv())
    expect(r).toEqual({ email: 'user@gmail.com', planType: 'free' })
  })

  it('sans GOOGLE_CLIENT_ID configuré, refuse le chemin financé', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: 'other' } })
    const env = {} as unknown as Env // GOOGLE_CLIENT_ID absent → expectedAud falsy
    expect(await checkAllowedUser(makeRequest(), env)).toBeNull()
  })
})

describe.each([
  { name: 'peek', check: checkAllowedUserPeek },
  { name: 'consume', check: checkAllowedUser },
])('$name — audience valide ne remplace pas les droits vérifiés', ({ check }) => {
  it.each(['aud', 'azp'] as const)('%s Arty mais D1 absente : indisponible, jamais Free', async field => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { [field]: CLIENT_ID } })
    expect(await check(makeRequest(), makeEnv(false))).toEqual({ error: 'admission_unavailable' })
  })
})
