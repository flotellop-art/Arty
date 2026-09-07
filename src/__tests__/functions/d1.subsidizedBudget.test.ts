// @vitest-environment node
import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchSubsidizedAttempt as dispatch, reserveSubsidizedAttempt as reserve,
  type SubsidizedEnvelope } from '../../../functions/api/_lib/subsidizedBudget'

const SCOPE = 'arty-subsidized', MAX = Number.MAX_SAFE_INTEGER
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const envelope: SubsidizedEnvelope = { policyRevision: 1, ceilingMicroUsd: 60, envelopeId: 'synthetic-text-v1' }
const schema = readFileSync(new URL('../../../migrations/0013_subsidized_budget.sql', import.meta.url), 'utf8')
  .split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(';').filter(sql => sql.trim())
let mf: Miniflare, db: D1Database
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: ':memory:' } })
  db = await mf.getD1Database('DB') as unknown as D1Database
})
afterAll(async () => { await mf.dispose() })
beforeEach(async () => {
  // Local, isolated D1 only. Recreate even after deliberately corrupted schemas.
  await db.prepare('DROP TABLE IF EXISTS subsidized_attempt_v1').run()
  await db.prepare('DROP TABLE IF EXISTS subsidized_budget_v1').run()
  for (const sql of schema) await db.prepare(sql).run()
  await db.prepare(`INSERT INTO subsidized_budget_v1
    (scope, revision, enabled, limit_micro_usd, limit_attempts) VALUES (?, 1, 1, 100, 10)`).bind(SCOPE).run()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function policy() { return db.prepare('SELECT * FROM subsidized_budget_v1').first<Record<string, unknown>>() }
async function attempts() { return (await db.prepare('SELECT * FROM subsidized_attempt_v1 ORDER BY id').all()).results }
async function admitted(e: SubsidizedEnvelope = envelope) {
  const r = await reserve(db, e)
  expect(r.status).toBe('reserved')
  if (r.status !== 'reserved') throw new Error('Expected synthetic reservation')
  return r.ticket
}
async function totals(micro: number, n: number) {
  expect(await policy()).toMatchObject({ reserved_micro_usd: micro, reserved_attempts: n, pending_admission_id: null })
  const a = await attempts()
  expect(a).toHaveLength(n)
  expect(a.reduce((sum, row) => sum + Number((row as Record<string, unknown>).ceiling_micro_usd), 0)).toBe(micro)
}
// Execute the REAL D1 operation first, then drop/alter its acknowledgement.
function batchFault(after: (result: D1Result[]) => Promise<D1Result[]>): D1Database {
  return new Proxy(db, { get(target, key) {
    if (key === 'batch') return async (statements: D1PreparedStatement[]) => after(await target.batch(statements))
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
function engageFault(after: (result: D1Result) => Promise<D1Result>): D1Database {
  return new Proxy(db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => {
      const stmt = target.prepare(sql)
      return { bind: (...values: unknown[]) => ({ all: async () => after(await stmt.bind(...values).all()) }) }
    }
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

describe('cumulative subsidized budget, real isolated D1', () => {
  it('reserves an exact monetary cap, freezes only allowed fields and never sends during reservation', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('No external network authorized') })
    vi.stubGlobal('fetch', fetchSpy)
    const ticket = await admitted({ ...envelope, ceilingMicroUsd: 100, email: 'not-persisted@example.test' } as SubsidizedEnvelope)
    expect(Object.isFrozen(ticket)).toBe(true)
    expect(Object.keys(ticket).sort()).toEqual(['ceilingMicroUsd', 'envelopeId', 'id', 'policyRevision'])
    expect(await reserve(db, { ...envelope, ceilingMicroUsd: 1 })).toEqual({ status: 'budget_exhausted' })
    expect(JSON.stringify(await attempts())).not.toContain('not-persisted')
    expect(fetchSpy).not.toHaveBeenCalled(); await totals(100, 1)
  })
  it('admits one of twenty concurrent accounts sharing the last monetary unit', async () => {
    await db.prepare('UPDATE subsidized_budget_v1 SET limit_micro_usd = 1').run()
    const out = await Promise.all(Array.from({ length: 20 }, () => reserve(db, { ...envelope, ceilingMicroUsd: 1 })))
    expect(out.filter(r => r.status === 'reserved')).toHaveLength(1)
    expect(out.filter(r => r.status === 'budget_exhausted')).toHaveLength(19)
    await totals(1, 1)
  })
  it('admits one of twenty concurrent tickets sharing the last attempt, with differing amounts', async () => {
    await db.prepare('UPDATE subsidized_budget_v1 SET limit_attempts = 1').run()
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(db, { ...envelope, ceilingMicroUsd: i + 1 })))
    const winners = out.filter(r => r.status === 'reserved')
    expect(winners).toHaveLength(1)
    expect(out.filter(r => r.status === 'budget_exhausted')).toHaveLength(19)
    const winner = winners[0]; if (winner.status !== 'reserved') throw new Error('Missing winner')
    await totals(winner.ticket.ceilingMicroUsd, 1)
  })
  it('does not reset by date, caller metadata, Google/OTP channel or revision', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T23:59:59Z'))
    await admitted({ ...envelope, google: 'a', hostname: 'tryarty.com' } as SubsidizedEnvelope)
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-09-08T00:00:01Z'))
    expect(await reserve(db, { ...envelope, otp: 'b', ip: '192.0.2.1', hostname: 'other.appfacade.pages.dev' } as SubsidizedEnvelope))
      .toEqual({ status: 'budget_exhausted' })
    await db.prepare('UPDATE subsidized_budget_v1 SET revision = 2').run()
    expect(await reserve(db, { ...envelope, policyRevision: 2 })).toEqual({ status: 'budget_exhausted' })
    expect(await reserve(db, envelope)).toEqual({ status: 'unavailable' })
    await totals(60, 1)
  })
  it('never recreates a missing policy or provisions missing tables', async () => {
    await db.prepare('DELETE FROM subsidized_budget_v1').run()
    expect(await reserve(db, envelope)).toEqual({ status: 'unavailable' })
    expect(await policy()).toBeNull(); expect(await attempts()).toEqual([])
    await db.prepare('DROP TABLE subsidized_attempt_v1').run()
    expect(await reserve(db, envelope)).toEqual({ status: 'unavailable' })
    expect(await reserve(undefined, envelope)).toEqual({ status: 'unavailable' })
  })
  it('rolls back a strict UUID collision even when the cap is exhausted', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(ID)
    await admitted({ ...envelope, ceilingMicroUsd: 100 })
    const before = await attempts()
    expect(await reserve(db, { ...envelope, ceilingMicroUsd: 1, envelopeId: 'different' })).toEqual({ status: 'unavailable' })
    expect(await attempts()).toEqual(before); await totals(100, 1)
  })
  it.each([0, 1])('cannot admit with an orphaned marker equal to the new UUID (enabled=%s)', async enabled => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(ID)
    await db.prepare('UPDATE subsidized_budget_v1 SET limit_micro_usd = 0, enabled = ?, pending_admission_id = ?')
      .bind(enabled, ID).run()
    expect((await reserve(db, envelope)).status).toBe(enabled ? 'budget_exhausted' : 'unavailable')
    await totals(0, 0)
  })
  it.each(['increment', 'final-clear'])('rolls back the whole transaction when %s fails', async when => {
    const event = when === 'increment' ? 'AFTER UPDATE OF reserved_attempts' : 'BEFORE UPDATE OF pending_admission_id'
    const condition = when === 'increment' ? 'NEW.reserved_attempts = 1' : 'OLD.pending_admission_id IS NOT NULL AND NEW.pending_admission_id IS NULL'
    await db.prepare(`CREATE TRIGGER stop_admission ${event} ON subsidized_budget_v1 WHEN ${condition}
      BEGIN SELECT RAISE(ABORT, 'synthetic transaction failure'); END`).run()
    expect(await reserve(db, envelope)).toEqual({ status: 'unavailable' })
    await totals(0, 0)
  })
  it.each(['reject', 'false-success', 'truncated'])('retains a real commit with an untrustworthy batch ACK: %s', async mode => {
    const faulty = batchFault(async result => {
      if (mode === 'reject') throw new Error('synthetic lost ACK')
      if (mode === 'truncated') return result.slice(0, 6)
      return result.map((r, i) => i === 6 ? { ...r, success: false } : r)
    })
    expect(await reserve(faulty, envelope)).toEqual({ status: 'unavailable' })
    await totals(60, 1)
    expect(await reserve(db, envelope)).toEqual({ status: 'budget_exhausted' })
  })
  it('does not overflow at the exact largest safe integer', async () => {
    await db.prepare('UPDATE subsidized_budget_v1 SET limit_micro_usd = ?, limit_attempts = ?').bind(MAX, MAX).run()
    await admitted({ ...envelope, ceilingMicroUsd: MAX - 1 })
    await admitted({ ...envelope, ceilingMicroUsd: 1 })
    expect(await reserve(db, { ...envelope, ceilingMicroUsd: 1 })).toEqual({ status: 'budget_exhausted' })
    await totals(MAX, 2)
  })
  it.each([0, -1, 0.5, MAX + 1, Number.NaN, Number.POSITIVE_INFINITY, '1', null])('rejects invalid money before any D1: %s', async amount => {
    const noDb = { batch: vi.fn(() => { throw new Error('must not be reached') }) } as unknown as D1Database
    expect(await reserve(noDb, { ...envelope, ceilingMicroUsd: amount } as SubsidizedEnvelope)).toEqual({ status: 'unavailable' })
    expect(noDb.batch).not.toHaveBeenCalled(); await totals(0, 0)
  })
  it.each([0, -1, 1.5, MAX + 1, '1', null])('rejects invalid policy revisions: %s', async revision => {
    expect(await reserve(db, { ...envelope, policyRevision: revision } as SubsidizedEnvelope)).toEqual({ status: 'unavailable' })
    await totals(0, 0)
  })
  it.each(['', 'x'.repeat(97), 'model\n', 'PII@example.test', '../path'])('rejects unbounded or invalid envelope IDs: %s', async envelopeId => {
    expect(await reserve(db, { ...envelope, envelopeId })).toEqual({ status: 'unavailable' }); await totals(0, 0)
  })
})

describe('one acknowledged CAS permits one callback only', () => {
  it('executes only one of ten concurrent dispatches; duplicate dispatch cannot resend', async () => {
    const ticket = await admitted(), send = vi.fn(async () => new Response('synthetic'))
    const out = await Promise.all(Array.from({ length: 10 }, () => dispatch(db, ticket, send)))
    expect(out.filter(r => r.status === 'sent')).toHaveLength(1)
    expect(out.filter(r => r.status === 'unavailable')).toHaveLength(9)
    expect(await dispatch(db, ticket, send)).toEqual({ status: 'unavailable' })
    expect(send).toHaveBeenCalledTimes(1); await totals(60, 1)
    expect(await attempts()).toMatchObject([{ state: 'engaged' }])
  })
  it('keeps the first reserve when a 5xx callback result is followed by a refused fallback', async () => {
    const ticket = await admitted(), send = vi.fn(async () => new Response('synthetic', { status: 500 }))
    const result = await dispatch(db, ticket, send)
    expect(result.status).toBe('sent')
    if (result.status === 'sent') expect(result.value.status).toBe(500)
    expect(await reserve(db, envelope)).toEqual({ status: 'budget_exhausted' })
    expect(send).toHaveBeenCalledTimes(1); await totals(60, 1)
  })
  it('keeps the reserve after a provider exception, without retrying', async () => {
    const ticket = await admitted(), send = vi.fn(async () => { throw new Error('synthetic response lost') })
    expect(await dispatch(db, ticket, send)).toEqual({ status: 'provider_unknown' })
    expect(await dispatch(db, ticket, send)).toEqual({ status: 'unavailable' })
    expect(send).toHaveBeenCalledTimes(1); await totals(60, 1)
  })
  it.each(['reject', 'false-success', 'empty'])('never sends after a committed CAS with unknown ACK: %s', async mode => {
    const ticket = await admitted(), send = vi.fn(async () => 'not sent')
    const faulty = engageFault(async result => {
      if (mode === 'reject') throw new Error('synthetic lost CAS ACK')
      return mode === 'empty' ? { ...result, results: [] } : { ...result, success: false }
    })
    expect(await dispatch(faulty, ticket, send)).toEqual({ status: 'unavailable' })
    expect(await attempts()).toMatchObject([{ state: 'engaged' }])
    expect(await dispatch(db, ticket, send)).toEqual({ status: 'unavailable' })
    expect(send).not.toHaveBeenCalled(); await totals(60, 1)
  })
  it.each(['disabled', 'revision'])('refuses a pending ticket after policy %s without returning money', async change => {
    const ticket = await admitted(), send = vi.fn(async () => 'not sent')
    await db.prepare(change === 'disabled' ? 'UPDATE subsidized_budget_v1 SET enabled = 0'
      : 'UPDATE subsidized_budget_v1 SET revision = 2').run()
    expect(await dispatch(db, ticket, send)).toEqual({ status: 'unavailable' })
    expect(send).not.toHaveBeenCalled(); await totals(60, 1)
    expect(await attempts()).toMatchObject([{ state: 'reserved' }])
  })
  it.each(['before', 'after-CAS'])('does not send an aborted attempt (%s)', async when => {
    const ticket = await admitted(), send = vi.fn(async () => 'not sent'), controller = new AbortController()
    if (when === 'before') controller.abort()
    const bound = when === 'before' ? db : engageFault(async result => { controller.abort(); return result })
    expect(await dispatch(bound, ticket, send, controller.signal)).toEqual({ status: 'unavailable' })
    expect(send).not.toHaveBeenCalled(); await totals(60, 1)
    expect(await attempts()).toMatchObject([{ state: when === 'before' ? 'reserved' : 'engaged' }])
  })
  it('does not dispatch for altered ticket parameters or missing D1', async () => {
    const ticket = await admitted(), send = vi.fn(async () => 'not sent')
    for (const changed of [{ ...ticket, ceilingMicroUsd: 1 }, { ...ticket, policyRevision: 2 },
      { ...ticket, envelopeId: 'another' }, { ...ticket, id: 'not-a-uuid' }]) {
      expect(await dispatch(db, changed, send)).toEqual({ status: 'unavailable' })
    }
    expect(await dispatch(undefined, ticket, send)).toEqual({ status: 'unavailable' })
    expect(send).not.toHaveBeenCalled(); await totals(60, 1)
  })
  it('does not lower engagement timestamp if server time moves backwards', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const ticket = await admitted()
    vi.mocked(Date.now).mockReturnValue(999)
    expect((await dispatch(db, ticket, async () => 'synthetic')).status).toBe('sent')
    expect(await attempts()).toMatchObject([{ created_at: 1000, engaged_at: 1000 }]); await totals(60, 1)
  })
})

describe('write guards reject pre-existing corrupt policy schemas', () => {
  // Deliberately recreate ONLY this isolated test policy without CHECKs. This
  // simulates schema drift, not a claim that the shipped constraints allow it.
  const cases = [
    ['reserved_micro_usd', -1], ['reserved_micro_usd', 0.5], ['reserved_micro_usd', 'invalid'],
    ['reserved_attempts', -1], ['reserved_attempts', 1.5], ['reserved_attempts', null],
    ['limit_micro_usd', MAX + 1], ['limit_micro_usd', 'invalid'], ['limit_attempts', 0.5],
    ['revision', 1.5], ['revision', '1'], ['enabled', '1'], ['enabled', 2],
  ] as const
  it.each(cases)('refuses corrupt %s=%s without creating a ticket or changing totals', async (column, value) => {
    await db.prepare('DROP TABLE subsidized_attempt_v1').run()
    await db.prepare('DROP TABLE subsidized_budget_v1').run()
    await db.prepare(`CREATE TABLE subsidized_budget_v1 (scope TEXT PRIMARY KEY, revision, enabled,
      limit_micro_usd, limit_attempts, reserved_micro_usd, reserved_attempts, pending_admission_id TEXT)`).run()
    await db.prepare(schema[1]).run()
    await db.prepare(`INSERT INTO subsidized_budget_v1 VALUES (?, 1, 1, 100, 10, 0, 0, NULL)`).bind(SCOPE).run()
    // The column comes from the fixed allowlist above, never request data.
    await db.prepare(`UPDATE subsidized_budget_v1 SET ${column} = ?`).bind(value).run()
    const before = await policy()
    expect(await reserve(db, envelope)).toEqual({ status: 'unavailable' })
    expect(await policy()).toEqual(before); expect(await attempts()).toEqual([])
  })
})

describe('CAS rejects a pre-existing corrupt journal without repairing it', () => {
  const cases = [['created_at', null], ['created_at', 'invalid'], ['created_at', 1.5],
    ['created_at', -1], ['created_at', MAX + 1], ['engaged_at', 1],
    ['policy_revision', '1'], ['ceiling_micro_usd', '60']] as const
  it.each(cases)('refuses corrupt journal %s=%s before callback', async (column, value) => {
    const ticket = await admitted(), send = vi.fn(async () => 'not sent')
    await db.prepare('ALTER TABLE subsidized_attempt_v1 RENAME TO attempt_backup').run()
    await db.prepare(`CREATE TABLE subsidized_attempt_v1 (id TEXT PRIMARY KEY, scope TEXT,
      policy_revision, ceiling_micro_usd, envelope_id TEXT, state TEXT, created_at, engaged_at)`).run()
    await db.prepare('INSERT INTO subsidized_attempt_v1 SELECT * FROM attempt_backup').run()
    await db.prepare('DROP TABLE attempt_backup').run()
    await db.prepare(`UPDATE subsidized_attempt_v1 SET ${column} = ?`).bind(value).run()
    const before = await attempts(), beforePolicy = await policy()
    expect(await dispatch(db, ticket, send)).toEqual({ status: 'unavailable' })
    expect(send).not.toHaveBeenCalled()
    expect(await attempts()).toEqual(before); expect(await policy()).toEqual(beforePolicy)
  })
})
