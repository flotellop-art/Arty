// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { parseWorkspaceEvent } from '../../../functions/api/workspace-addon/phase0/_lib/event'
import { createPhase0Handler } from '../../../functions/api/workspace-addon/phase0/_lib/runtime'
import {
  Phase0Error,
  type VerifiedWorkspaceRequest,
} from '../../../functions/api/workspace-addon/phase0/_lib/types'

const MESSAGE_SCOPE = 'https://www.googleapis.com/auth/gmail.addons.current.message.action'

const identity: VerifiedWorkspaceRequest = {
  system: {
    issuer: 'https://accounts.google.com',
    subject: 'system-subject',
    email: 'workspace-addon@example.iam.gserviceaccount.com',
    audience: 'https://tryarty.com/api/workspace-addon/phase0/home',
  },
  user: {
    issuer: 'https://accounts.google.com',
    subject: 'user-subject',
    email: 'user@example.com',
    audience: 'addon-client.apps.googleusercontent.com',
  },
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    GOOGLE_CLIENT_ID: 'unused',
    GOOGLE_CLIENT_SECRET: 'unused',
    WORKSPACE_ADDON_PHASE0_ENABLED: 'true',
    WORKSPACE_ADDON_PHASE0_BASE_URL: 'https://tryarty.com',
    WORKSPACE_ADDON_PHASE0_OAUTH_CLIENT_ID: 'addon-client.apps.googleusercontent.com',
    WORKSPACE_ADDON_PHASE0_SERVICE_ACCOUNT_EMAIL: 'workspace-addon@example.iam.gserviceaccount.com',
    WORKSPACE_ADDON_PHASE0_HOST_ACTION_SHAPE: 'rpc',
    ...overrides,
  } as Env
}

function rawEvent(scopes: readonly string[] = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  MESSAGE_SCOPE,
]): Record<string, unknown> {
  return {
    commonEventObject: { hostApp: 'GMAIL', platform: 'WEB' },
    authorizationEventObject: {
      systemIdToken: 'system.payload.signature',
      userIdToken: 'user.payload.signature',
      authorizedScopes: scopes,
    },
  }
}

function request(body: unknown = rawEvent(), pathname = '/api/workspace-addon/phase0/home'): Request {
  return new Request(`https://tryarty.com${pathname}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer system.payload.signature',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function invoke(handler: PagesFunction<Env>, req: Request, bindings = env()): Promise<Response> {
  return handler({ request: req, env: bindings } as never) as Promise<Response>
}

describe('Workspace Add-on Phase 0 runtime boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('keeps the whole surface closed until the exact kill switch is enabled', async () => {
    const authenticateSystem = vi.fn()
    const authenticateUser = vi.fn()
    const handle = vi.fn()
    const handler = createPhase0Handler({
      route: 'home',
      parseEvent: parseWorkspaceEvent,
      handle,
    }, { authenticateSystem, authenticateUser, randomUUID: () => 'request-disabled' })

    const response = await invoke(
      handler,
      new Request('https://tryarty.com/api/workspace-addon/phase0/home', {
        method: 'POST',
        body: 'not-json',
      }),
      env({ WORKSPACE_ADDON_PHASE0_ENABLED: 'TRUE' }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
    expect(authenticateSystem).not.toHaveBeenCalled()
    expect(authenticateUser).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects a route/audience mismatch before parsing, auth, or any effect', async () => {
    const authenticateSystem = vi.fn()
    const authenticateUser = vi.fn()
    const handle = vi.fn()
    const handler = createPhase0Handler({
      route: 'home',
      parseEvent: parseWorkspaceEvent,
      handle,
    }, { authenticateSystem, authenticateUser, randomUUID: () => 'request-route' })

    const response = await invoke(handler, request(rawEvent(), '/api/workspace-addon/phase0/read'))

    expect(response.status).toBe(404)
    expect(authenticateSystem).not.toHaveBeenCalled()
    expect(authenticateUser).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
  })

  it('returns granular scope acquisition only after identity authentication', async () => {
    const authenticateSystem = vi.fn(async () => identity.system)
    const authenticateUser = vi.fn(async () => identity.user)
    const handle = vi.fn()
    const handler = createPhase0Handler({
      route: 'home',
      parseEvent: parseWorkspaceEvent,
      requiredScopes: [MESSAGE_SCOPE],
      handle,
    }, { authenticateSystem, authenticateUser, randomUUID: () => 'request-scopes' })

    const eventWithoutUserScope = rawEvent([])
    delete (eventWithoutUserScope.authorizationEventObject as Record<string, unknown>).userIdToken
    const response = await invoke(handler, request(eventWithoutUserScope))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      requesting_google_scopes: {
        scopes: [
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
          MESSAGE_SCOPE,
        ],
      },
    })
    expect(authenticateSystem).toHaveBeenCalledOnce()
    expect(authenticateUser).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
  })

  it('does not run the handler when authentication fails and does not log event PII', async () => {
    const authenticateSystem = vi.fn(async () => {
      throw new Phase0Error('system_id_token_invalid', { status: 401 })
    })
    const authenticateUser = vi.fn()
    const handle = vi.fn()
    const event = {
      ...rawEvent(),
      gmail: {
        messageId: 'msg-f:secret-message-id',
        threadId: 'thread-f:secret-thread-id',
      },
    }
    const handler = createPhase0Handler({
      route: 'home',
      parseEvent: parseWorkspaceEvent,
      handle,
    }, { authenticateSystem, authenticateUser, randomUUID: () => 'request-auth-fail' })

    const response = await invoke(handler, request(event))
    const logged = JSON.stringify([
      vi.mocked(console.log).mock.calls,
      vi.mocked(console.warn).mock.calls,
      vi.mocked(console.error).mock.calls,
    ])

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'system_id_token_invalid' })
    expect(handle).not.toHaveBeenCalled()
    expect(authenticateUser).not.toHaveBeenCalled()
    expect(logged).not.toContain('secret-message-id')
    expect(logged).not.toContain('secret-thread-id')
  })

  it('turns an authenticated Gmail-safe failure into a card without reflecting secrets', async () => {
    const authenticateSystem = vi.fn(async () => identity.system)
    const authenticateUser = vi.fn(async () => identity.user)
    const handler = createPhase0Handler({
      route: 'home',
      parseEvent: parseWorkspaceEvent,
      handle: async () => {
        throw new Phase0Error('gmail_draft_create_failed', {
          status: 403,
          upstreamStatus: 403,
          cardSafe: true,
        })
      },
    }, { authenticateSystem, authenticateUser, randomUUID: () => 'request-card-error' })

    const response = await invoke(handler, request())
    const json = JSON.stringify(await response.json())

    expect(response.status).toBe(200)
    expect(json).toContain('gmail_draft_create_failed')
    expect(json).toContain('HTTP amont 403')
    expect(json).not.toContain('system.payload.signature')
  })

  it('applies the request limit to the verified user subject before the route effect', async () => {
    const authenticateSystem = vi.fn(async () => identity.system)
    const authenticateUser = vi.fn(async () => identity.user)
    const enforceUserRateLimit = vi.fn(() => {
      throw new Phase0Error('phase0_rate_limited', { status: 429, cardSafe: true })
    })
    const handle = vi.fn()
    const handler = createPhase0Handler({
      route: 'home',
      parseEvent: parseWorkspaceEvent,
      handle,
    }, {
      authenticateSystem,
      authenticateUser,
      enforceUserRateLimit,
      randomUUID: () => 'request-rate-limit',
    })

    const response = await invoke(handler, request())

    expect(response.status).toBe(200)
    expect(enforceUserRateLimit).toHaveBeenCalledWith('user-subject', expect.any(Number))
    expect(handle).not.toHaveBeenCalled()
  })

  it('passes a deeply frozen copy of the verified identity to the route handler', async () => {
    const system = { ...identity.system }
    const user = { ...identity.user }
    const authenticateSystem = vi.fn(async () => system)
    const authenticateUser = vi.fn(async () => user)
    const handle = vi.fn(({ identity: verifiedIdentity }) => {
      expect(verifiedIdentity).not.toBe(identity)
      expect(verifiedIdentity.system).not.toBe(system)
      expect(verifiedIdentity.user).not.toBe(user)
      expect(Object.isFrozen(verifiedIdentity)).toBe(true)
      expect(Object.isFrozen(verifiedIdentity.system)).toBe(true)
      expect(Object.isFrozen(verifiedIdentity.user)).toBe(true)
      expect(() => {
        (verifiedIdentity.user as { subject: string }).subject = 'tampered-subject'
      }).toThrow()
      return { ok: true }
    })
    const handler = createPhase0Handler({
      route: 'home',
      parseEvent: parseWorkspaceEvent,
      handle,
    }, {
      authenticateSystem,
      authenticateUser,
      randomUUID: () => 'request-frozen-identity',
    })

    const response = await invoke(handler, request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(user.subject).toBe('user-subject')
    expect(handle).toHaveBeenCalledOnce()
  })
})

function collectFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const target = path.join(root, entry)
    return statSync(target).isDirectory() ? collectFiles(target) : [target]
  })
}

const FORBIDDEN_SEND_PATTERNS = [
  /\/messages\/send\b/i,
  /\/drafts\/[^/\s]+\/send\b/i,
  /\b(?:messages|drafts|GmailDraft)\s*\.\s*send\b/i,
] as const

function containsForbiddenSend(source: string): boolean {
  return FORBIDDEN_SEND_PATTERNS.some((pattern) => pattern.test(source))
}

describe('Workspace Add-on Phase 0 static security invariants', () => {
  it('keeps deployment scopes exact and contains no send operation', () => {
    const deployment = JSON.parse(readFileSync(
      path.resolve('google-workspace-addon/phase0/deployment.template.json'),
      'utf8',
    )) as { oauthScopes: string[] }
    expect([...deployment.oauthScopes].sort()).toEqual([
      'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
      'https://www.googleapis.com/auth/gmail.addons.current.message.action',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',
    ].sort())

    const implementationRoot = path.resolve('functions/api/workspace-addon')
    const implementationFiles = collectFiles(implementationRoot)
      .filter((file) => file.endsWith('.ts'))
    const source = implementationFiles
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    for (const restricted of [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/drive',
    ]) {
      expect(source).not.toContain(restricted)
      expect(deployment.oauthScopes).not.toContain(restricted)
    }
    for (const file of implementationFiles) {
      expect(
        containsForbiddenSend(readFileSync(file, 'utf8')),
        `forbidden Gmail send operation in ${path.relative(implementationRoot, file)}`,
      ).toBe(false)
    }
  })

  it('recognizes every forbidden Gmail send spelling guarded by the recursive scan', () => {
    for (const forbidden of [
      "fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')",
      "fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/r-123/send')",
      'messages.send(payload)',
      'drafts.send(payload)',
      'GmailDraft.send()',
    ]) {
      expect(containsForbiddenSend(forbidden)).toBe(true)
    }
  })

  it('keeps every exposed Phase 0 route behind the shared authenticated handler', () => {
    const routeRoot = path.resolve('functions/api/workspace-addon/phase0')
    const routeFiles = collectFiles(routeRoot)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.relative(routeRoot, file))
      .filter((file) => !file.split(path.sep).includes('_lib'))
      .sort()

    expect(routeFiles).toEqual(['context.ts', 'create-draft.ts', 'home.ts', 'read.ts'])
    for (const file of routeFiles) {
      const source = readFileSync(path.resolve(routeRoot, file), 'utf8')
      expect(source).toContain('createPhase0Handler({')
      expect(source).toContain('export const onRequestPost')
      expect(source).not.toMatch(/export const onRequest(?:Get|Put|Delete|Patch)/)
    }
  })
})
