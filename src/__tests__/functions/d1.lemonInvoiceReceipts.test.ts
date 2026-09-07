// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import type { Env } from '../../../functions/env'
import { onRequestPost } from '../../../functions/api/webhook/lemonsqueezy'
import { makeD1Harness, type D1Harness } from './d1Harness'

const SECRET = 'invoice-receipts-synthetic-secret'
const EVENTS = ['subscription_payment_failed', 'subscription_payment_success',
  'subscription_payment_recovered', 'subscription_payment_refunded'] as const
const RIGHTS_TABLES = ['subscriptions', 'licenses', 'premium_packs', 'wallet',
  'credit_ledger', 'reservation', 'webhook_event', 'wallet_reversal'] as const
let h: D1Harness
beforeAll(async () => {
  h = await makeD1Harness({ LEMONSQUEEZY_WEBHOOK_SECRET: SECRET })
  await h.db.prepare('CREATE TABLE invoice_test_guard (enabled INTEGER NOT NULL)').run()
  await h.db.prepare('INSERT INTO invoice_test_guard VALUES (0)').run()
  // Real SQLite triggers fail on ANY attempted row mutation, even same-value
  // writes. A test-only switch allows fixture setup/cleanup without removing them.
  await h.db.batch(RIGHTS_TABLES.flatMap(table => ['INSERT', 'UPDATE', 'DELETE'].map(operation =>
    h.db.prepare(`CREATE TRIGGER guard_${table}_${operation} BEFORE ${operation} ON ${table}
      WHEN (SELECT enabled FROM invoice_test_guard) = 1
      BEGIN SELECT RAISE(ABORT, 'invoice touched rights'); END`))))
})
beforeEach(async () => {
  await h.db.prepare('UPDATE invoice_test_guard SET enabled = 0').run()
  await h.reset()
})
afterAll(async () => { await h.dispose() })

function invoice(event = 'subscription_payment_failed', attrs: Record<string, unknown> = {}) {
  return {
    meta: { event_name: event },
    data: {
      type: 'subscription-invoices', id: '901',
      attributes: {
        store_id: 11, subscription_id: 201, customer_id: 301, test_mode: true,
        user_email: 'invoice@example.com', status: 'pending', currency: 'EUR',
        total: 999, refunded_amount: 0, refunded: false, refunded_at: null,
        updated_at: '2026-09-07T12:00:00.123456Z', ...attrs,
      },
    },
  }
}

async function post(payload: unknown, options: {
  raw?: string; headers?: Record<string, string>; env?: Env; secret?: string
} = {}): Promise<Response> {
  const body = options.raw ?? JSON.stringify(payload)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(options.secret ?? SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  const hex = Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('')
  const request = new Request('https://tryarty.com/api/webhook/lemonsqueezy', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Signature': hex, ...options.headers }, body,
  })
  return onRequestPost({ request, env: options.env ?? h.env } as never)
}

async function receipts() {
  return (await h.db.prepare('SELECT * FROM lemon_invoice_receipt_v1 ORDER BY receipt_hash').all()).results
}

async function freezeRights(run: () => Promise<void>) {
  const snapshot = () => Promise.all(RIGHTS_TABLES.map(async table =>
    [table, (await h.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results]))
  const before = await snapshot()
  await h.db.prepare('UPDATE invoice_test_guard SET enabled = 1').run()
  try {
    await run()
    expect(await snapshot()).toEqual(before)
  } finally {
    await h.db.prepare('UPDATE invoice_test_guard SET enabled = 0').run()
  }
}

async function seedRights() {
  // Include a legacy NULL provider clock: calling ensureSubscriptionsTable would
  // backfill it and fail the UPDATE trigger even without touching the addressee.
  await h.db.batch([
    ...['subscription', 'pro', 'vip', 'inactive'].map((plan, index) => h.db.prepare(`
      INSERT INTO subscriptions (user_email, ls_subscription_id, status, plan_type,
        current_period_end, provider_updated_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, '2026-08-01T00:00:00Z', NULL, '2026-08-01 00:00:00')`)
      .bind(`${plan}@example.com`, String(201 + index), plan === 'inactive' ? 'expired' : 'active', plan)),
    h.db.prepare("INSERT INTO licenses (user_email, license_key, ls_order_id) VALUES ('pro@example.com', 'synthetic-license', '401')"),
    h.db.prepare("INSERT INTO premium_packs (user_email, ls_order_id, messages_used) VALUES ('vip@example.com', '402', 80)"),
    h.db.prepare("INSERT INTO wallet (user_email, balance_micro, reserved_micro) VALUES ('pro@example.com', 2000000, 500000)"),
    h.db.prepare("INSERT INTO credit_ledger (user_email, amount_micro, kind) VALUES ('pro@example.com', 2000000, 'topup')"),
    h.db.prepare("INSERT INTO reservation (id, user_email, reserved_micro) VALUES ('r1', 'pro@example.com', 500000)"),
    h.db.prepare("INSERT INTO webhook_event (provider, event_id, kind) VALUES ('creem', 'e1', 'topup')"),
    h.db.prepare("INSERT INTO wallet_reversal (provider, event_id, order_id, kind, ratio_numerator, ratio_denominator) VALUES ('creem', 'e2', 'o1', 'refund', 1, 2)"),
  ])
}

describe('Lemon invoice observations never confer subscription rights', () => {
  it('does not create a paid subscription from a failed invoice before subscription_created', async () => {
    await freezeRights(async () => { expect((await post(invoice())).status).toBe(200) })
    expect((await h.db.prepare('SELECT * FROM subscriptions').all()).results).toEqual([])
    expect(await receipts()).toHaveLength(1)
  })

  it.each(EVENTS)('%s cannot overwrite expired, subscription, Pro, VIP, licenses or wallets', async event => {
    await seedRights()
    await freezeRights(async () => {
      for (const plan of ['inactive', 'subscription', 'pro', 'vip']) {
        expect((await post(invoice(event, { user_email: `${plan}@example.com` }))).status).toBe(200)
      }
    })
    expect(await receipts()).toHaveLength(4)
  })

  it.each([false, true])('preserves failed, success + recovered and partial/full refunds in either order (reverse=%s)', async reverse => {
    await seedRights()
    const observations = [
      invoice(), invoice(EVENTS[1], { status: 'paid' }), invoice(EVENTS[2], { status: 'paid' }),
      invoice(EVENTS[3], { status: 'partial_refund', refunded_amount: 200 }),
      invoice(EVENTS[3], { status: 'partial_refund', refunded_amount: 450 }),
      invoice(EVENTS[3], { status: 'refunded', refunded: true, refunded_amount: 999,
        refunded_at: '2026-09-07T12:30:00.123457Z' }),
    ]
    await freezeRights(async () => {
      for (const payload of reverse ? observations.reverse() : observations) expect((await post(payload)).status).toBe(200)
    })
    const rows = await receipts()
    expect(rows).toHaveLength(6)
    expect(rows.every(row => row.outcome === 'captured')).toBe(true)
    expect(rows.filter(row => row.event_name === EVENTS[3]).map(row => row.refunded_minor).sort()).toEqual([200, 450, 999])
  })

  it('deduplicates concurrent exact replay, without replacing the first receipt', async () => {
    await freezeRights(async () => {
      expect((await Promise.all(Array.from({ length: 6 }, () => post(invoice())))).map(r => r.status)).toEqual(Array(6).fill(200))
      const before = await receipts()
      expect(before).toHaveLength(1)
      expect((await post(invoice())).status).toBe(200)
      expect(await receipts()).toEqual(before)
    })
  })

  it('keeps store/mode, exact microseconds and contradictory same-revision observations separate', async () => {
    const variants = [{}, { store_id: 12 }, { test_mode: false }, { subscription_id: 202 },
      { updated_at: '2026-09-07T12:00:00.123457Z' }, { total: 1234 }]
    await freezeRights(async () => {
      for (const attrs of variants) expect((await post(invoice(EVENTS[1], attrs))).status).toBe(200)
    })
    const rows = await receipts()
    expect(rows).toHaveLength(6)
    expect(new Set(rows.map(row => row.provider_updated_at))).toEqual(new Set([
      '2026-09-07T12:00:00.123456Z', '2026-09-07T12:00:00.123457Z',
    ]))
    expect(new Set(rows.map(row => row.test_mode))).toEqual(new Set([0, 1]))
  })

  it('documents different serializations separately and ignores the unsigned event header', async () => {
    const payload = invoice()
    await freezeRights(async () => {
      expect((await post(payload, { headers: { 'X-Event-Name': 'subscription_created' } })).status).toBe(200)
      expect((await post(payload)).status).toBe(200)
      expect(await receipts()).toHaveLength(1)
      expect((await post(payload, { raw: JSON.stringify(payload, null, 2) })).status).toBe(200)
    })
    expect(await receipts()).toHaveLength(2)
  })

  it('retains no email, name, card, signed PDF URL, custom data or raw payload', async () => {
    const payload = invoice(EVENTS[1], { user_email: 'private-person@private.example', user_name: 'Private Person',
      card_last_four: '4242', card_brand: 'private-card',
      urls: { invoice_url: 'https://example.test/private-signed-document?secret=private-secret' } })
    Object.assign(payload.meta, { custom_data: { owner: 'private-owner' } })
    await freezeRights(async () => { expect((await post(payload)).status).toBe(200) })
    const rows = await receipts()
    expect(rows[0]).toMatchObject({ invoice_id: '901', subscription_id: '201', customer_id: '301', store_id: '11' })
    const saved = JSON.stringify(rows)
    expect(saved).not.toMatch(/private|4242|user_email|card|urls|custom_data|raw_body|payload/i)
    expect(rows[0].receipt_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    ['store_id', undefined], ['subscription_id', 'private-email@example.com'], ['customer_id', 0],
    ['test_mode', undefined], ['test_mode', 'false'], ['status', 'failed'], ['currency', 'eur'],
    ['total', -1], ['total', Number.MAX_SAFE_INTEGER + 1], ['refunded_amount', 0.1],
    ['refunded', 'false'], ['updated_at', '2026-02-30T12:00:00Z'], ['updated_at', undefined],
    ['refunded_at', 'not-a-timestamp'],
  ])('captures invalid %s=%s as review, never silently assuming live or granting rights', async (field, value) => {
    await freezeRights(async () => { expect((await post(invoice(EVENTS[1], { [field]: value }))).status).toBe(200) })
    const rows = await receipts()
    expect(rows).toHaveLength(1)
    expect(rows[0].outcome).toBe('review')
    expect(String(rows[0].reason).split(',')).toContain(field)
    if (field === 'test_mode') expect(rows[0].test_mode).toBeNull()
    expect(JSON.stringify(rows)).not.toContain('private-email')
  })

  it('keeps invalid invoice IDs as review rather than losing an authenticated observation', async () => {
    const payload = invoice()
    payload.data.id = 'invalid-provider-id'
    await freezeRights(async () => { expect((await post(payload)).status).toBe(200) })
    expect((await receipts())[0]).toMatchObject({ invoice_id: null, outcome: 'review', reason: 'invoice_id' })
  })

  it('flags an impossible refund amount without using it as a debit', async () => {
    await freezeRights(async () => { expect((await post(invoice(EVENTS[3], { refunded_amount: 1000 }))).status).toBe(200) })
    expect((await receipts())[0]).toMatchObject({ outcome: 'review', reason: 'refund_exceeds_total', refunded_minor: 1000 })
  })

  it.each(['subscription_created', 'subscription_updated', 'subscription_cancelled', 'subscription_expired',
    'order_created', 'license_key_created'])('rejects an invoice disguised as %s', async event => {
    await seedRights()
    await freezeRights(async () => { expect((await post(invoice(event))).status).toBe(400) })
    expect(await receipts()).toEqual([])
  })

  it.each(EVENTS)('rejects %s carrying a subscription instead of an invoice', async event => {
    const payload = invoice(event)
    payload.data.type = 'subscriptions'
    await freezeRights(async () => { expect((await post(payload)).status).toBe(400) })
    expect(await receipts()).toEqual([])
  })

  it.each([null, [], {}, { meta: null }, { meta: { event_name: 5 } },
    { meta: { event_name: EVENTS[0] }, data: null }, { meta: { event_name: EVENTS[0] }, data: [] }])(
    'rejects malformed envelopes without side effects (%j)', async payload => {
      await freezeRights(async () => { expect((await post(payload)).status).toBe(400) })
      expect(await receipts()).toEqual([])
    })

  it('rejects bad signature and invalid JSON before recording anything', async () => {
    await freezeRights(async () => {
      expect((await post(invoice(), { secret: 'wrong-secret' })).status).toBe(401)
      expect((await post(invoice(), { headers: { 'X-Signature': '' } })).status).toBe(401)
      expect((await post(null, { raw: '{' })).status).toBe(400)
    })
    expect(await receipts()).toEqual([])
  })

  it('requires configured database and secret', async () => {
    expect((await post(invoice(), { env: { ...h.env, DB: undefined } as unknown as Env })).status).toBe(500)
    expect((await post(invoice(), { env: { ...h.env, LEMONSQUEEZY_WEBHOOK_SECRET: undefined } })).status).toBe(500)
    expect(await receipts()).toEqual([])
  })

  it('does not acknowledge a failed insert; retry succeeds exactly once after recovery', async () => {
    await h.db.prepare(`CREATE TRIGGER fail_receipt BEFORE INSERT ON lemon_invoice_receipt_v1
      BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END`).run()
    try {
      await freezeRights(async () => { expect((await post(invoice())).status).toBe(500) })
      expect(await receipts()).toEqual([])
    } finally { await h.db.prepare('DROP TRIGGER fail_receipt').run() }
    await freezeRights(async () => {
      expect((await post(invoice())).status).toBe(200)
      expect((await post(invoice())).status).toBe(200)
    })
    expect(await receipts()).toHaveLength(1)
  })

  it('recovers idempotently when persistence succeeds but acknowledgement confirmation fails', async () => {
    // Only the confirmation read fails; the write is still actual D1, not a mock.
    const faultDb = { prepare(sql: string) {
      if (sql.startsWith('SELECT receipt_hash')) return { bind() { return { first() { throw new Error('synthetic read loss') } } } }
      return h.db.prepare(sql)
    } } as unknown as D1Database
    await freezeRights(async () => {
      expect((await post(invoice(), { env: { ...h.env, DB: faultDb } })).status).toBe(500)
      const committed = await receipts()
      expect(committed).toHaveLength(1)
      expect((await post(invoice())).status).toBe(200)
      expect(await receipts()).toEqual(committed)
    })
  })

  it('does not let the invoice timestamp poison a later canonical subscription event', async () => {
    await freezeRights(async () => { expect((await post(invoice(EVENTS[1], { updated_at: '2099-01-01T00:00:00Z' }))).status).toBe(200) })
    const canonical = { meta: { event_name: 'subscription_updated' }, data: { type: 'subscriptions', id: '201',
      attributes: { user_email: 'invoice@example.com', status: 'active', updated_at: '2026-09-07T12:01:00Z',
        renews_at: '2026-10-07T12:01:00Z', customer_id: 301, variant_id: 401 } } }
    expect((await post(canonical)).status).toBe(200)
    expect(await h.db.prepare('SELECT * FROM subscriptions').first()).toMatchObject({
      ls_subscription_id: '201', status: 'active', provider_updated_at: '2026-09-07T12:01:00.000Z',
      current_period_end: '2026-10-07T12:01:00Z',
    })
    await freezeRights(async () => { expect((await post(invoice(EVENTS[3]))).status).toBe(200) })
  })

  it('applies migration 0010 twice without touching an old subscription schema or backfilling rights', async () => {
    const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: { DB: ':memory:' } })
    try {
      const db = await mf.getD1Database('DB') as unknown as D1Database
      const env = { ...h.env, DB: db }
      const source = readFileSync(new URL('../../../migrations/0010_lemon_invoice_receipts.sql', import.meta.url), 'utf8')
      const statements = source.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(';').map(sql => sql.trim()).filter(Boolean)
      // Missing migration must fail, never fall back to creating an entitlement.
      expect((await post(invoice(), { env })).status).toBe(500)
      for (const sql of statements) await db.prepare(sql).run()
      expect((await post(invoice(), { env })).status).toBe(200)
      expect((await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'").all()).results).toEqual([])
      await db.prepare('CREATE TABLE subscriptions (user_email TEXT, provider_updated_at TEXT, updated_at TEXT)').run()
      await db.prepare("INSERT INTO subscriptions VALUES ('legacy@example.com', NULL, '2026-08-01 00:00:00')").run()
      const rows = await db.prepare('SELECT * FROM subscriptions').all()
      const columns = await db.prepare('PRAGMA table_info(subscriptions)').all()
      for (const sql of statements) await db.prepare(sql).run()
      for (const event of EVENTS) expect((await post(invoice(event), { env })).status).toBe(200)
      expect((await db.prepare('SELECT * FROM subscriptions').all()).results).toEqual(rows.results)
      expect((await db.prepare('PRAGMA table_info(subscriptions)').all()).results).toEqual(columns.results)
      expect((await db.prepare('SELECT * FROM lemon_invoice_receipt_v1').all()).results).toHaveLength(4)
      expect((await db.prepare('PRAGMA table_info(lemon_invoice_receipt_v1)').all()).results)
        .toEqual((await h.db.prepare('PRAGMA table_info(lemon_invoice_receipt_v1)').all()).results)
    } finally { await mf.dispose() }
  })
})
