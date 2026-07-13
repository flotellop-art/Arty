// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Miniflare } from 'miniflare'
import {
  PHASE0_IDEMPOTENCY_TTL_MS,
  completePhase0Idempotency,
  derivePhase0IdempotencyKey,
  reservePhase0Idempotency,
  type Phase0IdempotencyOwner,
} from '../../../functions/api/workspace-addon/phase0/_lib/idempotency'

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

afterAll(async () => {
  await miniflare.dispose()
})

const input = {
  userSub: 'google-user-subject-123',
  messageId: 'msg-f:current-456',
  nonce: 'action-nonce-789',
}

describe('Workspace Add-on Phase 0 D1 idempotency', () => {
  it('dérive une clé SHA-256 stable sans stocker les identifiants source', async () => {
    const first = await derivePhase0IdempotencyKey(input)
    const second = await derivePhase0IdempotencyKey({ ...input })
    const changed = await derivePhase0IdempotencyKey({ ...input, nonce: 'another-nonce' })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
    expect(changed).not.toBe(first)
    const expectedMaterial = JSON.stringify([
      'workspace-addon-phase0:create-draft:v1',
      input.userSub,
      input.messageId,
      input.nonce,
    ])
    const expectedDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(expectedMaterial),
    )
    expect(first).toBe(Buffer.from(expectedDigest).toString('hex'))

    const reservation = await reservePhase0Idempotency(db, input, {
      now: () => 1_000,
      randomUUID: () => 'owner-token-no-pii',
    })
    expect(reservation.status).toBe('owner')

    const rows = await db.prepare(
      `SELECT * FROM workspace_addon_phase0_idempotency`,
    ).all<Record<string, unknown>>()
    const stored = JSON.stringify(rows.results)
    expect(stored).not.toContain(input.userSub)
    expect(stored).not.toContain(input.messageId)
    expect(stored).not.toContain(input.nonce)
  })

  it('accorde un seul owner atomique et renvoie pending au concurrent', async () => {
    const concurrentInput = { ...input, nonce: 'concurrent-reservation' }
    const [left, right] = await Promise.all([
      reservePhase0Idempotency(db, concurrentInput, {
        now: () => 2_000,
        randomUUID: () => 'owner-left',
      }),
      reservePhase0Idempotency(db, concurrentInput, {
        now: () => 2_000,
        randomUUID: () => 'owner-right',
      }),
    ])

    expect([left.status, right.status].sort()).toEqual(['owner', 'pending'])
  })

  it('complète par owner puis restitue le brouillon sans nouvelle réservation', async () => {
    const completedInput = { ...input, nonce: 'completed-reservation' }
    const reserved = await reservePhase0Idempotency(db, completedInput, {
      now: () => 3_000,
      randomUUID: () => 'owner-completed',
    })
    expect(reserved.status).toBe('owner')

    const owner = reserved as Phase0IdempotencyOwner
    const completed = await completePhase0Idempotency(
      db,
      owner,
      { draftId: 'r-123', threadId: 'api-thread-456' },
      { now: () => 3_100 },
    )
    expect(completed).toMatchObject({
      status: 'completed',
      draftId: 'r-123',
      threadId: 'api-thread-456',
    })

    await expect(completePhase0Idempotency(
      db,
      owner,
      { draftId: 'r-123', threadId: 'api-thread-456' },
      { now: () => 3_200 },
    )).resolves.toEqual(completed)

    await expect(reservePhase0Idempotency(db, completedInput, {
      now: () => 3_300,
      randomUUID: () => 'unused-owner',
    })).resolves.toEqual(completed)
  })

  it('garde pending après une complete perdue et bloque le retry', async () => {
    const pendingInput = { ...input, nonce: 'lost-completion' }
    const reserved = await reservePhase0Idempotency(db, pendingInput, {
      now: () => 4_000,
      randomUUID: () => 'actual-owner',
    }) as Phase0IdempotencyOwner

    await expect(completePhase0Idempotency(
      db,
      { ...reserved, ownerToken: 'wrong-owner' },
      { draftId: 'r-uncertain', threadId: 'thread-uncertain' },
      { now: () => 4_100 },
    )).rejects.toMatchObject({
      code: 'phase0_idempotency_completion_lost',
      status: 409,
    })

    await expect(reservePhase0Idempotency(db, pendingInput, {
      now: () => 4_200,
      randomUUID: () => 'retry-owner',
    })).resolves.toEqual({ status: 'pending', key: reserved.key })

    const row = await db.prepare(
      `SELECT status, draft_id, thread_id FROM workspace_addon_phase0_idempotency
       WHERE idempotency_key = ?1`,
    ).bind(reserved.key).first()
    expect(row).toEqual({ status: 'pending', draft_id: null, thread_id: null })
  })

  it('garde aussi pending si D1 échoue pendant complete', async () => {
    const pendingInput = { ...input, nonce: 'd1-complete-failure' }
    const reserved = await reservePhase0Idempotency(db, pendingInput, {
      now: () => 5_000,
      randomUUID: () => 'owner-before-d1-failure',
    }) as Phase0IdempotencyOwner
    const completeFailingDb = {
      prepare(sql: string) {
        if (/^\s*UPDATE workspace_addon_phase0_idempotency/.test(sql)) {
          throw new Error('simulated D1 write failure')
        }
        return db.prepare(sql)
      },
    } as unknown as D1Database

    await expect(completePhase0Idempotency(
      completeFailingDb,
      reserved,
      { draftId: 'r-uncertain-d1', threadId: 'thread-uncertain-d1' },
      { now: () => 5_100 },
    )).rejects.toMatchObject({
      code: 'phase0_idempotency_complete_failed',
      status: 503,
    })

    await expect(reservePhase0Idempotency(db, pendingInput, {
      now: () => 5_200,
      randomUUID: () => 'retry-after-d1-failure',
    })).resolves.toEqual({ status: 'pending', key: reserved.key })
  })

  it('récupère le résultat si la réponse D1 se perd après le commit de complete', async () => {
    const committedInput = { ...input, nonce: 'committed-response-lost' }
    const reserved = await reservePhase0Idempotency(db, committedInput, {
      now: () => 6_000,
      randomUUID: () => 'owner-response-lost',
    }) as Phase0IdempotencyOwner
    const responseLosingDb = {
      prepare(sql: string) {
        const statement = db.prepare(sql)
        if (!/^\s*UPDATE workspace_addon_phase0_idempotency/.test(sql)) return statement
        return {
          bind(...values: unknown[]) {
            const bound = statement.bind(...values as D1_TYPE[])
            return {
              async first() {
                await bound.first()
                throw new Error('simulated response loss after commit')
              },
            }
          },
        } as unknown as D1PreparedStatement
      },
    } as unknown as D1Database

    await expect(completePhase0Idempotency(
      responseLosingDb,
      reserved,
      { draftId: 'r-committed', threadId: 'thread-committed' },
      { now: () => 6_100 },
    )).resolves.toMatchObject({
      status: 'completed',
      draftId: 'r-committed',
      threadId: 'thread-committed',
    })
  })

  it('ne réattribue jamais owner après 24 h et expurge seulement les IDs complétés', async () => {
    const pendingInput = { ...input, nonce: 'pending-after-ttl' }
    const pending = await reservePhase0Idempotency(db, pendingInput, {
      now: () => 10_000,
      randomUUID: () => 'pending-owner',
    }) as Phase0IdempotencyOwner

    const completedInput = { ...input, nonce: 'completed-after-ttl' }
    const completedOwner = await reservePhase0Idempotency(db, completedInput, {
      now: () => 11_000,
      randomUUID: () => 'completed-owner-before-redaction',
    }) as Phase0IdempotencyOwner
    await completePhase0Idempotency(
      db,
      completedOwner,
      { draftId: 'r-to-redact', threadId: 'thread-to-redact' },
      { now: () => 11_100 },
    )

    const afterTtl = 11_000 + PHASE0_IDEMPOTENCY_TTL_MS + 1
    await expect(reservePhase0Idempotency(db, pendingInput, {
      now: () => afterTtl,
      randomUUID: () => 'must-not-own-pending',
    })).resolves.toEqual({ status: 'pending', key: pending.key })
    await expect(reservePhase0Idempotency(db, completedInput, {
      now: () => afterTtl,
      randomUUID: () => 'must-not-own-completed',
    })).resolves.toEqual({ status: 'blocked', key: completedOwner.key })

    const redacted = await db.prepare(
      `SELECT owner_token, status, draft_id, thread_id
       FROM workspace_addon_phase0_idempotency WHERE idempotency_key = ?1`,
    ).bind(completedOwner.key).first()
    expect(redacted).toEqual({
      owner_token: '',
      status: 'blocked',
      draft_id: null,
      thread_id: null,
    })
  })

  it('échoue fermé sans journaliser lorsque D1 est indisponible', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failingDb = {
      prepare() {
        throw new Error('contains-sensitive-database-detail')
      },
    } as unknown as D1Database

    await expect(reservePhase0Idempotency(failingDb, {
      ...input,
      nonce: 'db-failure',
    }, {
      now: () => 20_000,
      randomUUID: () => 'owner-db-failure',
    })).rejects.toMatchObject({
      code: 'phase0_idempotency_reserve_failed',
      status: 503,
    })
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()

    consoleError.mockRestore()
    consoleWarn.mockRestore()
  })
})
