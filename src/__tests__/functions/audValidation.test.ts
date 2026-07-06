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
// Contrainte critique (BUG 21/51) : le token natif issu de serverAuthCode peut
// avoir un aud/azp indéterminé ; il ne doit PAS être verrouillé. Seule une
// audience ÉTRANGÈRE EXPLICITE est rejetée.

const CLIENT_ID = 'arty-web.apps.googleusercontent.com'
const OWNER_TOKEN = 'tok-abc'

function makeEnv(): Env {
  // DB absente → resolveUserPlan renvoie 'free' ; ALLOWED_EMAILS vide.
  return { GOOGLE_CLIENT_ID: CLIENT_ID } as unknown as Env
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
      return new Response(JSON.stringify({ email: opts.email }), { status: 200 })
    }
    if (url.includes('/tokeninfo')) {
      if (opts.tokeninfo === 'network_error') throw new Error('boom')
      if (opts.tokeninfo === 'http_error') return new Response('', { status: 400 })
      return new Response(JSON.stringify(opts.tokeninfo ?? {}), { status: 200 })
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
    expect(await checkAllowedUserPeek(makeRequest(), makeEnv())).toBeNull()
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

  it('NE VERROUILLE PAS un token natif sans aud/azp (fail-safe BUG 21/51)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: {} })
    const r = await checkAllowedUserPeek(makeRequest(), makeEnv())
    expect(r).toEqual({ email: 'user@gmail.com', planType: 'free' })
  })

  it('NE VERROUILLE PAS sur tokeninfo KO (incident transitoire → fail-safe)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: 'http_error' })
    const r = await checkAllowedUserPeek(makeRequest(), makeEnv())
    expect(r).toEqual({ email: 'user@gmail.com', planType: 'free' })
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
    expect(await checkAllowedUser(makeRequest(), makeEnv())).toBeNull()
  })

  it('ACCEPTE un token à audience Arty (plan free par défaut sans D1)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: CLIENT_ID } })
    const r = await checkAllowedUser(makeRequest(), makeEnv())
    expect(r).toEqual({ email: 'user@gmail.com', planType: 'free' })
  })

  it('sans GOOGLE_CLIENT_ID configuré, ne régresse pas (aud non vérifié)', async () => {
    stubGoogle({ email: 'user@gmail.com', tokeninfo: { aud: 'other' } })
    const env = {} as unknown as Env // GOOGLE_CLIENT_ID absent → expectedAud falsy
    const r = await checkAllowedUser(makeRequest(), env)
    expect(r).toEqual({ email: 'user@gmail.com', planType: 'free' })
  })
})
