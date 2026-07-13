import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import {
  freezeVerifiedWorkspaceRequest,
  Phase0Error,
  type Phase0Config,
  type VerifiedSystemIdentity,
  type VerifiedUserIdentity,
  type VerifiedWorkspaceRequest,
  type WorkspaceHttpEvent,
} from './types'

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const
const TOKEN_MAX_AGE = '1h'
const CLOCK_TOLERANCE_SECONDS = 30
const MAX_JWT_CHARS = 16 * 1024
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

// Deliberately distinct resolvers: the system proof and user proof never share
// verification state beyond Google's public endpoint and jose's own safeguards.
const SYSTEM_JWKS = createRemoteJWKSet(GOOGLE_JWKS_URL, {
  timeoutDuration: 2_500,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
})
const USER_JWKS = createRemoteJWKSet(GOOGLE_JWKS_URL, {
  timeoutDuration: 2_500,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
})

function requireStringClaim(payload: JWTPayload, name: string, maxLength: number): string {
  const value = payload[name]
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`claim_${name}_invalid`)
  }
  return value
}

function validateVerifiedPayload(payload: JWTPayload, expectedAudience: string): {
  issuer: string
  subject: string
  email: string
  audience: string
} {
  const issuer = requireStringClaim(payload, 'iss', 128)
  const subject = requireStringClaim(payload, 'sub', 255)
  const email = requireStringClaim(payload, 'email', 320)
  if (payload.email_verified !== true) throw new Error('claim_email_verified_invalid')
  if (payload.aud !== expectedAudience) throw new Error('claim_audience_invalid')
  // `azp` identifies the authorized presenter and is allowed to differ from
  // `aud` (notably for service-account-minted ID tokens). Since this boundary
  // already rejects multi-valued audiences and requires an exact string `aud`,
  // only validate the optional claim's shape here.
  if (
    payload.azp !== undefined
    && (typeof payload.azp !== 'string' || payload.azp.length === 0 || payload.azp.length > 255)
  ) {
    throw new Error('claim_azp_invalid')
  }
  return { issuer, subject, email, audience: expectedAudience }
}

function assertProtectedHeader(header: Record<string, unknown>): void {
  if (header.alg !== 'RS256') throw new Error('header_algorithm_invalid')
  if (typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 256) {
    throw new Error('header_key_id_invalid')
  }
  if (header.jku !== undefined || header.x5u !== undefined) throw new Error('header_remote_key_url_forbidden')
  if (header.crit !== undefined) throw new Error('header_critical_extension_forbidden')
  if (header.typ !== undefined && header.typ !== 'JWT') throw new Error('header_type_invalid')
}

export async function verifySystemIdToken(
  token: string,
  config: Phase0Config,
  expectedAudience: string,
): Promise<VerifiedSystemIdentity> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, SYSTEM_JWKS, {
      algorithms: ['RS256'],
      issuer: [...GOOGLE_ISSUERS],
      audience: expectedAudience,
      requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp', 'email', 'email_verified'],
      maxTokenAge: TOKEN_MAX_AGE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    })
    assertProtectedHeader(protectedHeader)
    const identity = validateVerifiedPayload(payload, expectedAudience)
    if (identity.email.toLowerCase() !== config.serviceAccountEmail.toLowerCase()) {
      throw new Error('service_account_mismatch')
    }
    return identity
  } catch {
    throw new Phase0Error('system_id_token_invalid', { status: 401 })
  }
}

export async function verifyUserIdToken(
  token: string,
  config: Phase0Config,
): Promise<VerifiedUserIdentity> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, USER_JWKS, {
      algorithms: ['RS256'],
      issuer: [...GOOGLE_ISSUERS],
      audience: config.oauthClientId,
      requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp', 'email', 'email_verified'],
      maxTokenAge: TOKEN_MAX_AGE,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    })
    assertProtectedHeader(protectedHeader)
    return validateVerifiedPayload(payload, config.oauthClientId)
  } catch {
    throw new Phase0Error('user_id_token_invalid', { status: 401 })
  }
}

export async function verifyWorkspaceAddonSystemRequest(
  request: Request,
  event: WorkspaceHttpEvent,
  config: Phase0Config,
  expectedAudience: string,
): Promise<VerifiedSystemIdentity> {
  const headerSystemToken = readSystemBearer(request)
  const [headerSystem, eventSystem] = await Promise.all([
    verifySystemIdToken(headerSystemToken, config, expectedAudience),
    verifySystemIdToken(event.authorizationEventObject.systemIdToken, config, expectedAudience),
  ])

  if (
    headerSystem.issuer !== eventSystem.issuer
    || headerSystem.subject !== eventSystem.subject
    || headerSystem.email.toLowerCase() !== eventSystem.email.toLowerCase()
  ) {
    throw new Phase0Error('system_proofs_mismatch', { status: 401 })
  }
  return headerSystem
}

export async function verifyWorkspaceAddonUserRequest(
  event: WorkspaceHttpEvent,
  config: Phase0Config,
): Promise<VerifiedUserIdentity> {
  const token = event.authorizationEventObject.userIdToken
  if (!token) throw new Phase0Error('user_id_token_missing', { status: 401 })
  return verifyUserIdToken(token, config)
}

function readSystemBearer(request: Request): string {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    throw new Phase0Error('system_bearer_missing', { status: 401 })
  }
  const token = authorization.slice('Bearer '.length)
  if (token.length > MAX_JWT_CHARS || !JWT_SHAPE.test(token)) {
    throw new Phase0Error('system_bearer_invalid', { status: 401 })
  }
  return token
}

export async function verifyWorkspaceAddonRequest(
  request: Request,
  event: WorkspaceHttpEvent,
  config: Phase0Config,
  expectedAudience: string,
): Promise<VerifiedWorkspaceRequest> {
  const [system, user] = await Promise.all([
    verifyWorkspaceAddonSystemRequest(request, event, config, expectedAudience),
    verifyWorkspaceAddonUserRequest(event, config),
  ])
  return freezeVerifiedWorkspaceRequest(system, user)
}
