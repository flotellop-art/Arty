// @vitest-environment node
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTPayload,
} from 'jose'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  Phase0Config,
  WorkspaceHttpEvent,
} from '../../../functions/api/workspace-addon/phase0/_lib/types'

const SYSTEM_AUDIENCE = 'https://tryarty.com/api/workspace-addon/phase0/home'
const USER_AUDIENCE = 'phase0-client.apps.googleusercontent.com'
const SERVICE_EMAIL = 'workspace-addon@example.iam.gserviceaccount.com'
const KEY_ID = 'phase0-test-key'

const config: Phase0Config = {
  baseUrl: 'https://tryarty.com',
  oauthClientId: USER_AUDIENCE,
  serviceAccountEmail: SERVICE_EMAIL,
  hostActionShape: 'rpc',
}

let privateKey: CryptoKey
let verifySystemIdToken: typeof import('../../../functions/api/workspace-addon/phase0/_lib/auth').verifySystemIdToken
let verifyUserIdToken: typeof import('../../../functions/api/workspace-addon/phase0/_lib/auth').verifyUserIdToken
let verifyWorkspaceAddonRequest: typeof import('../../../functions/api/workspace-addon/phase0/_lib/auth').verifyWorkspaceAddonRequest

async function signIdentity(
  audience: string | string[],
  subject: string,
  email: string,
  extra: JWTPayload = {},
  options: {
    issuedAt?: number
    expiresAt?: number
    emailVerified?: boolean
    kid?: string
    omitKid?: boolean
    signingKey?: CryptoKey
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000)
  return new SignJWT({
    email,
    email_verified: options.emailVerified ?? true,
    ...extra,
  })
    .setProtectedHeader({
      alg: 'RS256',
      ...(!options.omitKid ? { kid: options.kid ?? KEY_ID } : {}),
      typ: 'JWT',
    })
    .setIssuer('https://accounts.google.com')
    .setSubject(subject)
    .setAudience(audience)
    .setIssuedAt(options.issuedAt ?? now)
    .setExpirationTime(options.expiresAt ?? now + 3_600)
    .sign(options.signingKey ?? privateKey)
}

function event(systemIdToken: string, userIdToken: string): WorkspaceHttpEvent {
  return {
    commonEventObject: { hostApp: 'GMAIL', platform: 'WEB' },
    authorizationEventObject: {
      systemIdToken,
      userIdToken,
      authorizedScopes: [],
    },
  }
}

describe('Workspace Add-on Phase 0 Google ID-token verification', () => {
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey
    const jwk = await exportJWK(pair.publicKey)
    const fetchJwks = vi.fn(async () => Response.json({
      keys: [{ ...jwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    }, {
      headers: { 'cache-control': 'public, max-age=3600' },
    }))
    vi.stubGlobal('fetch', fetchJwks)

    const auth = await import('../../../functions/api/workspace-addon/phase0/_lib/auth')
    verifySystemIdToken = auth.verifySystemIdToken
    verifyUserIdToken = auth.verifyUserIdToken
    verifyWorkspaceAddonRequest = auth.verifyWorkspaceAddonRequest
  })

  afterAll(() => vi.unstubAllGlobals())

  it('accepts exact audiences, Google signatures, and a distinct optional presenter', async () => {
    const systemToken = await signIdentity(
      SYSTEM_AUDIENCE,
      'system-subject',
      SERVICE_EMAIL,
      { azp: 'google-authorized-presenter.apps.googleusercontent.com' },
    )
    const userToken = await signIdentity(USER_AUDIENCE, 'user-subject', 'user@example.com')

    await expect(verifySystemIdToken(systemToken, config, SYSTEM_AUDIENCE)).resolves.toMatchObject({
      subject: 'system-subject',
      email: SERVICE_EMAIL,
      audience: SYSTEM_AUDIENCE,
    })
    await expect(verifyUserIdToken(userToken, config)).resolves.toMatchObject({
      subject: 'user-subject',
      email: 'user@example.com',
      audience: USER_AUDIENCE,
    })
  })

  it('returns a deeply frozen combined identity context', async () => {
    const systemToken = await signIdentity(
      SYSTEM_AUDIENCE,
      'system-subject-frozen',
      SERVICE_EMAIL,
    )
    const userToken = await signIdentity(
      USER_AUDIENCE,
      'user-subject-frozen',
      'frozen-user@example.com',
    )
    const request = new Request(SYSTEM_AUDIENCE, {
      method: 'POST',
      headers: { authorization: `Bearer ${systemToken}` },
    })

    const identity = await verifyWorkspaceAddonRequest(
      request,
      event(systemToken, userToken),
      config,
      SYSTEM_AUDIENCE,
    )

    expect(Object.isFrozen(identity)).toBe(true)
    expect(Object.isFrozen(identity.system)).toBe(true)
    expect(Object.isFrozen(identity.user)).toBe(true)
  })

  it('fails closed on the wrong route audience, service account, or user client', async () => {
    const wrongRoute = await signIdentity(
      'https://tryarty.com/api/workspace-addon/phase0/read',
      'system-subject',
      SERVICE_EMAIL,
    )
    const wrongService = await signIdentity(
      SYSTEM_AUDIENCE,
      'system-subject',
      'attacker@example.iam.gserviceaccount.com',
    )
    const wrongClient = await signIdentity(
      'another-client.apps.googleusercontent.com',
      'user-subject',
      'user@example.com',
    )

    await expect(verifySystemIdToken(wrongRoute, config, SYSTEM_AUDIENCE)).rejects.toMatchObject({
      code: 'system_id_token_invalid',
      status: 401,
    })
    await expect(verifySystemIdToken(wrongService, config, SYSTEM_AUDIENCE)).rejects.toMatchObject({
      code: 'system_id_token_invalid',
      status: 401,
    })
    await expect(verifyUserIdToken(wrongClient, config)).rejects.toMatchObject({
      code: 'user_id_token_invalid',
      status: 401,
    })
  })

  it('rejects a multi-valued audience even when one value happens to match', async () => {
    const token = await signIdentity(
      [SYSTEM_AUDIENCE, 'https://attacker.example/callback'],
      'system-subject',
      SERVICE_EMAIL,
    )

    await expect(verifySystemIdToken(token, config, SYSTEM_AUDIENCE)).rejects.toMatchObject({
      code: 'system_id_token_invalid',
    })
  })

  it('requires the header and event system proofs to resolve to the same deployment identity', async () => {
    const headerSystem = await signIdentity(SYSTEM_AUDIENCE, 'system-subject', SERVICE_EMAIL)
    const eventSystem = await signIdentity(SYSTEM_AUDIENCE, 'other-system-subject', SERVICE_EMAIL)
    const user = await signIdentity(USER_AUDIENCE, 'user-subject', 'user@example.com')
    const request = new Request(SYSTEM_AUDIENCE, {
      method: 'POST',
      headers: { authorization: `Bearer ${headerSystem}` },
    })

    await expect(
      verifyWorkspaceAddonRequest(request, event(eventSystem, user), config, SYSTEM_AUDIENCE),
    ).rejects.toMatchObject({
      code: 'system_proofs_mismatch',
      status: 401,
    })
  })

  it('rejects expiration, future issuance, and an unverified email', async () => {
    const now = Math.floor(Date.now() / 1_000)
    const expired = await signIdentity(SYSTEM_AUDIENCE, 'system-subject', SERVICE_EMAIL, {}, {
      issuedAt: now - 3_600,
      expiresAt: now - 60,
    })
    const future = await signIdentity(SYSTEM_AUDIENCE, 'system-subject', SERVICE_EMAIL, {}, {
      issuedAt: now + 300,
      expiresAt: now + 3_600,
    })
    const unverified = await signIdentity(SYSTEM_AUDIENCE, 'system-subject', SERVICE_EMAIL, {}, {
      emailVerified: false,
    })

    for (const token of [expired, future, unverified]) {
      await expect(verifySystemIdToken(token, config, SYSTEM_AUDIENCE)).rejects.toMatchObject({
        code: 'system_id_token_invalid',
        status: 401,
      })
    }
  })

  it('rejects alg:none, a missing/unknown kid, and a signature from another key', async () => {
    const now = Math.floor(Date.now() / 1_000)
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const nonePayload = Buffer.from(JSON.stringify({
      iss: 'https://accounts.google.com',
      sub: 'system-subject',
      aud: SYSTEM_AUDIENCE,
      iat: now,
      exp: now + 3_600,
      email: SERVICE_EMAIL,
      email_verified: true,
    })).toString('base64url')
    const algNone = `${noneHeader}.${nonePayload}.`
    const unknownKid = await signIdentity(SYSTEM_AUDIENCE, 'system-subject', SERVICE_EMAIL, {}, {
      kid: 'unknown-google-key',
    })
    const missingKid = await signIdentity(SYSTEM_AUDIENCE, 'system-subject', SERVICE_EMAIL, {}, {
      omitKid: true,
    })
    const otherPair = await generateKeyPair('RS256')
    const wrongSignature = await signIdentity(SYSTEM_AUDIENCE, 'system-subject', SERVICE_EMAIL, {}, {
      signingKey: otherPair.privateKey,
    })

    for (const token of [algNone, missingKid, unknownKid, wrongSignature]) {
      await expect(verifySystemIdToken(token, config, SYSTEM_AUDIENCE)).rejects.toMatchObject({
        code: 'system_id_token_invalid',
        status: 401,
      })
    }
  })
})
