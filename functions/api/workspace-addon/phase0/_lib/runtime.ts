import type { Env } from '../../../../env'
import {
  verifyWorkspaceAddonSystemRequest,
  verifyWorkspaceAddonUserRequest,
} from './auth'
import { buildErrorCard, phase0RouteUrl, renderCard } from './cards'
import { requireAuthorizedScopes } from './event'
import { jsonResponse, readBoundedJson } from './http'
import {
  freezeVerifiedWorkspaceRequest,
  MissingScopesError,
  Phase0Error,
  PHASE0_ROUTE_PATHS,
  type FetchLike,
  type Phase0Config,
  type Phase0RouteName,
  type VerifiedSystemIdentity,
  type VerifiedUserIdentity,
  type VerifiedWorkspaceRequest,
  type WorkspaceHttpEvent,
} from './types'

const PHASE0_TIMEOUT_MS = 20_000
const MAX_CONFIG_VALUE_CHARS = 2_048
const USER_RATE_LIMIT = 120
const USER_RATE_WINDOW_MS = 60_000
const MAX_USER_RATE_BUCKETS = 5_000
const userRateBuckets = new Map<string, { count: number; resetAt: number }>()
const IDENTITY_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
] as const

export interface Phase0HandlerContext<TEvent extends WorkspaceHttpEvent> {
  request: Request
  env: Env
  event: TEvent
  identity: VerifiedWorkspaceRequest
  config: Phase0Config
  actionNonce: string
  signal: AbortSignal
  fetcher: FetchLike
}

export interface Phase0HandlerSpec<TEvent extends WorkspaceHttpEvent> {
  route: Phase0RouteName
  parseEvent: (raw: unknown) => TEvent
  requiredScopes?: readonly string[]
  handle: (context: Phase0HandlerContext<TEvent>) => Promise<unknown> | unknown
}

export type Phase0SystemAuthenticator = (
  request: Request,
  event: WorkspaceHttpEvent,
  config: Phase0Config,
  expectedAudience: string,
) => Promise<VerifiedSystemIdentity>

export type Phase0UserAuthenticator = (
  event: WorkspaceHttpEvent,
  config: Phase0Config,
) => Promise<VerifiedUserIdentity>

export type Phase0UserRateLimiter = (subject: string, nowMs: number) => void

export interface Phase0RuntimeOverrides {
  fetch?: FetchLike
  authenticateSystem?: Phase0SystemAuthenticator
  authenticateUser?: Phase0UserAuthenticator
  enforceUserRateLimit?: Phase0UserRateLimiter
  now?: () => number
  randomUUID?: () => string
}

function enforcePhase0UserRateLimit(subject: string, nowMs: number): void {
  const current = userRateBuckets.get(subject)
  if (!current || nowMs >= current.resetAt) {
    if (userRateBuckets.size >= MAX_USER_RATE_BUCKETS) {
      for (const [key, bucket] of userRateBuckets) {
        if (nowMs >= bucket.resetAt) userRateBuckets.delete(key)
      }
    }
    if (userRateBuckets.size >= MAX_USER_RATE_BUCKETS && !userRateBuckets.has(subject)) {
      throw new Phase0Error('phase0_rate_limiter_capacity', { status: 503, cardSafe: true })
    }
    userRateBuckets.set(subject, { count: 1, resetAt: nowMs + USER_RATE_WINDOW_MS })
    return
  }
  current.count += 1
  if (current.count > USER_RATE_LIMIT) {
    throw new Phase0Error('phase0_rate_limited', { status: 429, cardSafe: true })
  }
}

function requiredConfigValue(value: string | undefined, code: string): string {
  if (!value || value.length > MAX_CONFIG_VALUE_CHARS || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Phase0Error(code, { status: 503 })
  }
  return value
}

export function readPhase0Config(env: Env): Phase0Config {
  const rawBaseUrl = requiredConfigValue(
    env.WORKSPACE_ADDON_PHASE0_BASE_URL,
    'phase0_base_url_missing',
  )
  let base: URL
  try {
    base = new URL(rawBaseUrl)
  } catch {
    throw new Phase0Error('phase0_base_url_invalid', { status: 503 })
  }
  if (
    base.protocol !== 'https:'
    || base.username !== ''
    || base.password !== ''
    || base.pathname !== '/'
    || base.search !== ''
    || base.hash !== ''
  ) {
    throw new Phase0Error('phase0_base_url_invalid', { status: 503 })
  }

  const oauthClientId = requiredConfigValue(
    env.WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID,
    'phase0_oauth_client_missing',
  )
  if (/\s/.test(oauthClientId)) throw new Phase0Error('phase0_oauth_client_invalid', { status: 503 })

  const serviceAccountEmail = requiredConfigValue(
    env.WORKSPACE_ADDON_PHASE0_SERVICE_ACCOUNT_EMAIL,
    'phase0_service_account_missing',
  )
  if (!/^[^@\s]+@[^@\s]+$/.test(serviceAccountEmail)) {
    throw new Phase0Error('phase0_service_account_invalid', { status: 503 })
  }

  const hostActionShape = env.WORKSPACE_ADDON_PHASE0_HOST_ACTION_SHAPE
  if (hostActionShape !== 'rpc' && hostActionShape !== 'legacy') {
    throw new Phase0Error('phase0_host_action_shape_invalid', { status: 503 })
  }

  return {
    baseUrl: base.toString(),
    oauthClientId,
    serviceAccountEmail,
    hostActionShape,
  }
}

function assertExpectedRoute(request: Request, config: Phase0Config, route: Phase0RouteName): string {
  const expectedAudience = phase0RouteUrl(config, route)
  const incoming = new URL(request.url)
  if (
    incoming.origin !== new URL(config.baseUrl).origin
    || incoming.pathname !== PHASE0_ROUTE_PATHS[route]
    || incoming.search !== ''
    || incoming.hash !== ''
    || `${incoming.origin}${incoming.pathname}` !== expectedAudience
  ) {
    throw new Phase0Error('phase0_route_mismatch', { status: 404 })
  }
  return expectedAudience
}

function structuredLog(entry: {
  level: 'info' | 'warn' | 'error'
  event: string
  route: Phase0RouteName
  requestId: string
  durationMs?: number
  status?: number
  code?: string
  upstreamStatus?: number
  platform?: string
}): void {
  const line = JSON.stringify({ component: 'workspace_addon_phase0', ...entry })
  if (entry.level === 'error') console.error(line)
  else if (entry.level === 'warn') console.warn(line)
  else console.log(line)
}

export function createPhase0Handler<TEvent extends WorkspaceHttpEvent>(
  spec: Phase0HandlerSpec<TEvent>,
  overrides: Phase0RuntimeOverrides = {},
): PagesFunction<Env> {
  const fetcher = overrides.fetch ?? fetch
  const authenticateSystem = overrides.authenticateSystem ?? verifyWorkspaceAddonSystemRequest
  const authenticateUser = overrides.authenticateUser ?? verifyWorkspaceAddonUserRequest
  const enforceUserRateLimit = overrides.enforceUserRateLimit ?? enforcePhase0UserRateLimit
  const now = overrides.now ?? Date.now
  const randomUUID = overrides.randomUUID ?? (() => crypto.randomUUID())

  return async ({ request, env }) => {
    const startedAt = now()
    const requestId = randomUUID()
    // Distinct du requestId journalisé : le nonce est renvoyé dans la carte et
    // ne doit jamais apparaître dans les logs.
    const actionNonce = randomUUID()
    let systemAuthenticated = false
    let authenticated = false
    let platform: string | undefined
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const work = async (): Promise<Response> => {
      if (env.WORKSPACE_ADDON_PHASE0_ENABLED !== 'true') {
        structuredLog({ level: 'warn', event: 'disabled', route: spec.route, requestId, status: 404 })
        return jsonResponse({ error: 'not_found' }, { status: 404 })
      }

      const config = readPhase0Config(env)
      const expectedAudience = assertExpectedRoute(request, config, spec.route)
      const raw = await readBoundedJson(request)
      const event = spec.parseEvent(raw)
      platform = event.commonEventObject.platform
      const system = await authenticateSystem(request, event, config, expectedAudience)
      systemAuthenticated = true
      requireAuthorizedScopes(event, [...IDENTITY_SCOPES, ...(spec.requiredScopes ?? [])])
      const user = await authenticateUser(event, config)
      authenticated = true
      enforceUserRateLimit(user.subject, now())
      const identity = freezeVerifiedWorkspaceRequest(system, user)

      structuredLog({ level: 'info', event: 'accepted', route: spec.route, requestId, platform })
      const result = await spec.handle({
        request,
        env,
        event,
        identity,
        config,
        actionNonce,
        signal: controller.signal,
        fetcher,
      })
      return jsonResponse(result)
    }

    const deadline = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort('phase0_deadline')
        reject(new Phase0Error('phase0_timeout', { status: 504, cardSafe: true }))
      }, PHASE0_TIMEOUT_MS)
    })

    try {
      const response = await Promise.race([work(), deadline])
      structuredLog({
        level: 'info',
        event: 'completed',
        route: spec.route,
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        status: response.status,
        platform,
      })
      return response
    } catch (caught) {
      const error = controller.signal.aborted
        ? new Phase0Error('phase0_timeout', { status: 504, cardSafe: true })
        : caught instanceof Phase0Error
          ? caught
          : new Phase0Error('phase0_internal_error', { status: 500 })

      structuredLog({
        level: error.status >= 500 ? 'error' : 'warn',
        event: 'rejected',
        route: spec.route,
        requestId,
        durationMs: Math.max(0, now() - startedAt),
        status: error.status,
        code: error.code,
        upstreamStatus: error.upstreamStatus,
        platform,
      })

      if (error instanceof MissingScopesError && systemAuthenticated) {
        return jsonResponse({ requesting_google_scopes: { scopes: error.scopes } })
      }
      if (error.cardSafe && authenticated) {
        return jsonResponse(renderCard(buildErrorCard(error.code, error.upstreamStatus)))
      }
      const publicCode = error.status >= 500 ? 'phase0_unavailable' : error.code
      return jsonResponse({ error: publicCode }, { status: error.status })
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }
}
