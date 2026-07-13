// @vitest-environment node
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { handleCreateDraft } from '../../../functions/api/workspace-addon/phase0/create-draft'
import { parseWorkspaceEvent, requireGmailContext } from '../../../functions/api/workspace-addon/phase0/_lib/event'
import {
  PHASE0_IDEMPOTENCY_TTL_MS,
  completePhase0Idempotency,
  reservePhase0Idempotency,
  type Phase0IdempotencyOwner,
} from '../../../functions/api/workspace-addon/phase0/_lib/idempotency'
import type { Phase0HandlerContext } from '../../../functions/api/workspace-addon/phase0/_lib/runtime'
import type {
  FetchLike,
  GmailContextEvent,
  Phase0Config,
  VerifiedWorkspaceRequest,
} from '../../../functions/api/workspace-addon/phase0/_lib/types'

let miniflare: Miniflare
let db: D1Database

beforeAll(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { WORKSPACE_ADDON_PHASE0_DB: ':memory:' },
  })
  db = await miniflare.getD1Database('WORKSPACE_ADDON_PHASE0_DB') as unknown as D1Database
})

afterAll(async () => miniflare.dispose())

const config: Phase0Config = {
  baseUrl: 'https://tryarty.com',
  oauthClientId: 'phase0-client.apps.googleusercontent.com',
  serviceAccountEmail: 'workspace-addon@example.iam.gserviceaccount.com',
  hostActionShape: 'rpc',
}

const identity: VerifiedWorkspaceRequest = {
  system: {
    issuer: 'https://accounts.google.com',
    subject: 'system-subject',
    email: config.serviceAccountEmail,
    audience: 'https://tryarty.com/api/workspace-addon/phase0/create-draft',
  },
  user: {
    issuer: 'https://accounts.google.com',
    subject: 'user-subject-route-test',
    email: 'user@example.com',
    audience: config.oauthClientId,
  },
}

function event(actionNonce = 'route-test-action-nonce-1234'): GmailContextEvent {
  return requireGmailContext(parseWorkspaceEvent({
    commonEventObject: {
      hostApp: 'GMAIL',
      platform: 'WEB',
      parameters: { phase0_action_nonce: actionNonce },
      formInputs: {
        phase0_reply_body: {
          stringInputs: { value: ['Bonjour,\n\nMerci pour votre message.'] },
        },
      },
    },
    authorizationEventObject: {
      systemIdToken: 'system.payload.signature',
      userIdToken: 'user.payload.signature',
      userOAuthToken: 'ya29.user-token',
      authorizedScopes: [],
    },
    gmail: {
      messageId: 'msg-f:route-message-123',
      threadId: 'thread-f:route-thread-456',
      accessToken: 'gmail-context-token',
    },
  }))
}

function messageResponse(): Response {
  return Response.json({
    id: 'api-message-123',
    threadId: 'api-thread-456',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Paul Exemple <paul@example.com>' },
        { name: 'Subject', value: 'Devis juillet' },
        { name: 'Message-ID', value: '<route-message-123@example.com>' },
        { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
      ],
      body: { data: Buffer.from('Bonjour Arty.', 'utf8').toString('base64url') },
    },
  })
}

describe('Workspace Add-on Phase 0 create-draft route', () => {
  it('creates once and reuses the completed D1 result on replay', async () => {
    const fetcher = vi.fn<FetchLike>(async (_input, init) => {
      if (init?.method === 'POST') {
        return Response.json({ id: 'r-route-123', message: { threadId: 'api-thread-456' } })
      }
      return messageResponse()
    })
    const context: Phase0HandlerContext<GmailContextEvent> = {
      request: new Request('https://tryarty.com/api/workspace-addon/phase0/create-draft'),
      env: {
        GOOGLE_CLIENT_ID: 'unused',
        GOOGLE_CLIENT_SECRET: 'unused',
        WORKSPACE_ADDON_PHASE0_DB: db,
      } as Env,
      event: event(),
      identity,
      config,
      actionNonce: 'runtime-card-nonce-unused-here',
      signal: AbortSignal.timeout(5_000),
      fetcher,
    }

    const first = await handleCreateDraft(context)
    const replay = await handleCreateDraft(context)

    expect(first).toEqual(replay)
    expect(first).toEqual({
      renderActions: {
        hostAppAction: {
          gmailAction: {
            openCreatedDraftAction: {
              draftId: 'msg-a:r-route-123',
              threadServerPermId: 'thread-f:route-thread-456',
            },
          },
        },
      },
    })
    const draftCreates = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    const messageReads = fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')
    expect(draftCreates).toHaveLength(1)
    expect(messageReads).toHaveLength(1)

    const row = await db.prepare(
      `SELECT status, draft_id, thread_id FROM workspace_addon_phase0_idempotency`,
    ).first()
    expect(row).toEqual({
      status: 'completed',
      draft_id: 'r-route-123',
      thread_id: 'api-thread-456',
    })
  })

  it('fails before Gmail when the dedicated idempotency binding is absent', async () => {
    const fetcher = vi.fn<FetchLike>()
    const context = {
      request: new Request('https://tryarty.com/api/workspace-addon/phase0/create-draft'),
      env: { GOOGLE_CLIENT_ID: 'unused', GOOGLE_CLIENT_SECRET: 'unused' } as Env,
      event: event(),
      identity,
      config,
      actionNonce: 'runtime-card-nonce-unused-here',
      signal: AbortSignal.timeout(5_000),
      fetcher,
    } satisfies Phase0HandlerContext<GmailContextEvent>

    await expect(handleCreateDraft(context)).rejects.toMatchObject({
      code: 'phase0_idempotency_db_missing',
      status: 503,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fails before reading Gmail when the D1 reservation itself is unavailable', async () => {
    const fetcher = vi.fn<FetchLike>()
    const failingDb = {
      prepare() {
        throw new Error('simulated D1 outage')
      },
    } as unknown as D1Database
    const context = {
      request: new Request('https://tryarty.com/api/workspace-addon/phase0/create-draft'),
      env: {
        GOOGLE_CLIENT_ID: 'unused',
        GOOGLE_CLIENT_SECRET: 'unused',
        WORKSPACE_ADDON_PHASE0_DB: failingDb,
      } as Env,
      event: event('route-test-d1-outage-nonce'),
      identity,
      config,
      actionNonce: 'runtime-card-nonce-unused-here',
      signal: AbortSignal.timeout(5_000),
      fetcher,
    } satisfies Phase0HandlerContext<GmailContextEvent>

    await expect(handleCreateDraft(context)).rejects.toMatchObject({
      code: 'phase0_idempotency_reserve_failed',
      status: 503,
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('blocks an old completed card after its draft IDs have been expunged', async () => {
    const nonce = 'route-test-expired-card-nonce'
    const input = {
      userSub: identity.user.subject,
      messageId: 'msg-f:route-message-123',
      nonce,
    }
    const owner = await reservePhase0Idempotency(db, input, {
      now: () => 30_000,
      randomUUID: () => 'expired-card-owner',
    }) as Phase0IdempotencyOwner
    await completePhase0Idempotency(
      db,
      owner,
      { draftId: 'r-expired-card', threadId: 'api-thread-456' },
      { now: () => 30_100 },
    )
    await expect(reservePhase0Idempotency(db, input, {
      now: () => 30_000 + PHASE0_IDEMPOTENCY_TTL_MS + 1,
      randomUUID: () => 'must-never-own-expired-card',
    })).resolves.toEqual({ status: 'blocked', key: owner.key })

    const fetcher = vi.fn<FetchLike>(async () => messageResponse())
    const context: Phase0HandlerContext<GmailContextEvent> = {
      request: new Request('https://tryarty.com/api/workspace-addon/phase0/create-draft'),
      env: {
        GOOGLE_CLIENT_ID: 'unused',
        GOOGLE_CLIENT_SECRET: 'unused',
        WORKSPACE_ADDON_PHASE0_DB: db,
      } as Env,
      event: event(nonce),
      identity,
      config,
      actionNonce: 'runtime-card-nonce-unused-here',
      signal: AbortSignal.timeout(5_000),
      fetcher,
    }

    await expect(handleCreateDraft(context)).rejects.toMatchObject({
      code: 'phase0_draft_attempt_already_finalized',
      status: 409,
    })
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })
})
