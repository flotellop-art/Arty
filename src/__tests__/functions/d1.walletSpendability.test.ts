// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { creditWallet, drainWalletReversalsForUser, ensureWalletTables, getWalletBalance,
  readWalletBalance, registerWalletReversalClaim, reserveCredits, resolveWalletReversalsForTopup } from '../../../functions/api/_lib/wallet'
import { onRequestGet } from '../../../functions/api/wallet/balance'
import { beginWalletBilling } from '../../../functions/api/_lib/walletBilling'
import { readFileSync } from 'node:fs'
import { fetchWalletBalance, clearWalletCache, creditsCoverPremium, getWalletSnapshot } from '../../services/walletClient'

vi.mock('../../services/billingContext', () => ({
  onBillingContextInvalidated: () => () => {},
  captureBillingContext: () => ({ isCurrent: () => true, getAccessToken: async () => 'synthetic-owner-token' }),
}))
vi.mock('../../services/trialClient', () => ({ getTrialRemaining: () => null }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => `https://tryarty.com${path}` }))

const OWNER = 'wallet-owner@example.test', OTHER = 'wallet-other@example.test'
let h: D1Harness
let releaseDeadlines = () => {}
// Real D1 accounting with host-independent scheduling. Only 250ms callbacks
// are held; walletBalanceRead separately tests the exact deadline boundary.
function holdDeadlines() {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout
  const held = new Map<ReturnType<typeof setTimeout>, () => void>()
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay !== 250) return realSet(callback, delay, ...args)
    const handle = Object.create(null) as ReturnType<typeof setTimeout>
    held.set(handle, () => callback(...args))
    return handle
  }) as typeof setTimeout)
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(handle => {
    if (!held.delete(handle as ReturnType<typeof setTimeout>)) realClear(handle)
  })
  releaseDeadlines = () => { for (const callback of held.values()) callback(); held.clear() }
}

beforeAll(async () => { h = await makeD1Harness({ GOOGLE_CLIENT_ID: 'wallet-client' }) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => {
  await h.reset(); holdDeadlines()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/oauth2/v2/userinfo')) return Response.json({ email: OWNER, verified_email: true })
    if (url.includes('/tokeninfo')) return Response.json({ aud: 'wallet-client', email: OWNER, email_verified: true })
    throw new Error('Unexpected external request')
  }))
})
afterEach(() => { clearWalletCache(); releaseDeadlines(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function topup(email = OWNER, orderId = 'order-a') {
  expect(await creditWallet(h.env, { provider: 'creem', eventId: `topup-${orderId}-${email}`, orderId, email, amountMicro: 10_000_000 })).toEqual({ status: 'credited' })
}
async function claim(orderId = 'order-a', provider = 'creem') {
  expect(await registerWalletReversalClaim(h.env, { provider, eventId: `refund-${orderId}`, orderId,
    kind: 'refund', ratioNumerator: 1, ratioDenominator: 4 })).toEqual({ status: 'credited' })
}
async function snapshot() {
  return Promise.all(['wallet', 'credit_ledger', 'reservation', 'webhook_event', 'wallet_reversal'].map(async table =>
    (await h.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results))
}
async function readApi(query = '') {
  return onRequestGet({ env: h.env, request: new Request(`https://tryarty.com/api/wallet/balance${query}`,
    { headers: { 'x-google-token': 'synthetic-owner-token' } }) } as never)
}
async function reserve(id = 'new-reservation', email = OWNER) {
  return reserveCredits(h.env, { email, resId: id, estMicro: 1, model: 'gpt-5-mini', modality: 'text' })
}

describe('wallet spendability is not the accounting balance', () => {
  it('applies only the non-unique lookup index twice on a legacy schema without changing any financial row', async () => {
    await topup(); await claim()
    await h.db.prepare('DROP INDEX IF EXISTS idx_webhook_event_order_topup').run()
    const before = await snapshot()
    const sql = readFileSync(new URL('../../../migrations/0011_wallet_spendability_lookup.sql', import.meta.url), 'utf8')
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const statement of sql.split(';').filter(value => value.trim())) await h.db.prepare(statement).run()
      expect(await snapshot()).toEqual(before)
    }
    const indexes = await h.db.prepare("PRAGMA index_list('webhook_event')").all()
    expect(indexes.results).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'idx_webhook_event_order_topup', unique: 0 })]))
  })

  it('composes real D1, authenticated balance handler and client routing gate through refund and recovery', async () => {
    const googleFetch = globalThis.fetch
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) }, removeItem: (key: string) => { storage.delete(key) } })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/api/wallet/balance')
      ? onRequestGet({ env: h.env, request: new Request(input, init) } as never) : googleFetch(input, init)))
    await topup()
    expect(await fetchWalletBalance()).toMatchObject({ availableMicro: 10_000_000, reversalPending: false })
    expect(creditsCoverPremium()).toBe(true)
    await claim()
    const before = await snapshot()
    expect(await fetchWalletBalance()).toMatchObject({ balanceMicro: 10_000_000, availableMicro: 0, reversalPending: true })
    expect(getWalletSnapshot()?.availableMicro).toBe(0); expect(creditsCoverPremium()).toBe(false)
    expect(await snapshot()).toEqual(before)
    expect(await resolveWalletReversalsForTopup(h.env, { provider: 'creem', orderId: 'order-a', email: OWNER,
      topupMicro: 10_000_000 })).toEqual({ status: 'credited' })
    expect(await fetchWalletBalance()).toMatchObject({ availableMicro: 7_500_000, reversalPending: false })
    expect(creditsCoverPremium()).toBe(true)
  })

  it('keeps the committed topup intact but blocks reading/spending after a lost commit acknowledgement', async () => {
    await claim()
    let loseNext = false
    const db = new Proxy(h.db, { get(target, key) {
      if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
        const result = await target.batch(statements)
        if (loseNext) { loseNext = false; throw new Error('synthetic lost commit acknowledgement') }
        return result
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const env = { ...h.env, DB: db }
    await ensureWalletTables(env)
    loseNext = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await creditWallet(env, { provider: 'creem', eventId: 'lost-topup', orderId: 'order-a', email: OWNER, amountMicro: 10_000_000 })).toEqual({ status: 'error' })
    expect(loseNext).toBe(false)
    const before = await snapshot()
    expect(await getWalletBalance(h.env, OWNER)).toEqual({ balanceMicro: 10_000_000, reservedMicro: 0, availableMicro: 0, reversalPending: true })
    const response = await readApi(`?email=${encodeURIComponent(OTHER)}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ trialState: 'outside-trial', hasWallet: true, balanceMicro: 10_000_000, reservedMicro: 0, availableMicro: 0, reversalPending: true })
    expect(await snapshot()).toEqual(before)
    expect(await reserve()).toEqual({ status: 'insufficient' })
    expect(await snapshot()).toEqual(before)
    expect(await drainWalletReversalsForUser(h.env, OWNER)).toMatchObject({ status: 'ok', pendingMicro: 0 })
    // The drainer only knows attributed amounts. An unknown claim must remain
    // blocked until the existing order reconciliation explicitly resolves it.
    expect(await getWalletBalance(h.env, OWNER)).toMatchObject({ availableMicro: 0, reversalPending: true })
    expect(await resolveWalletReversalsForTopup(h.env, { provider: 'creem', orderId: 'order-a',
      email: OWNER, topupMicro: 10_000_000 })).toEqual({ status: 'credited' })
    expect(await getWalletBalance(h.env, OWNER)).toEqual({ balanceMicro: 7_500_000, reservedMicro: 0, availableMicro: 7_500_000, reversalPending: false })
    const recovered = await snapshot()
    expect(await drainWalletReversalsForUser(h.env, OWNER)).toMatchObject({ status: 'ok', pendingMicro: 0 })
    expect(await snapshot()).toEqual(recovered)
  })

  it.each(['other-order', 'other-provider', 'other-user'])('does not freeze a wallet for an unrelated unresolved claim (%s)', async kind => {
    await topup()
    if (kind === 'other-user') await topup(OTHER, 'other-order')
    await claim(kind === 'other-provider' ? 'order-a' : 'other-order', kind === 'other-provider' ? 'other-provider' : 'creem')
    expect(await getWalletBalance(h.env, OWNER)).toMatchObject({ availableMicro: 10_000_000, reversalPending: false })
    expect(await reserve()).toEqual({ status: 'reserved' })
  })

  it.each([
    { requested: 2_500_000, collected: 500_000, status: 'settled', pending: true },
    { requested: 2_500_000, collected: 2_500_000, status: 'pending', pending: false },
    { requested: 0, collected: 0, status: 'pending', pending: false },
  ])('uses outstanding amounts rather than notification status ($requested/$collected/$status)', async row => {
    await topup(); await claim()
    await h.db.prepare('UPDATE wallet_reversal SET user_email=?1, requested_micro=?2, collected_micro=?3, status=?4')
      .bind(OWNER, row.requested, row.collected, row.status).run()
    const before = await snapshot()
    expect(await getWalletBalance(h.env, OWNER)).toMatchObject({ balanceMicro: 10_000_000,
      availableMicro: row.pending ? 0 : 10_000_000, reversalPending: row.pending })
    expect(await snapshot()).toEqual(before)
    expect(await reserve()).toEqual({ status: row.pending ? 'insufficient' : 'reserved' })
  })

  it('protects existing holds and closes a refund arriving after a favorable read', async () => {
    await topup()
    expect(await reserveCredits(h.env, { email: OWNER, resId: 'old-hold', estMicro: 2_000_000, model: 'gpt-5-mini', modality: 'text' })).toEqual({ status: 'reserved' })
    expect(await getWalletBalance(h.env, OWNER)).toEqual({ balanceMicro: 10_000_000, reservedMicro: 2_000_000, availableMicro: 8_000_000, reversalPending: false })
    await claim()
    const before = await snapshot()
    expect(await reserve('late-hold')).toEqual({ status: 'insufficient' })
    expect(await getWalletBalance(h.env, OWNER)).toEqual({ balanceMicro: 10_000_000, reservedMicro: 2_000_000, availableMicro: 0, reversalPending: true })
    expect(await snapshot()).toEqual(before)
  })

  it('returns a terminal financial-state conflict instead of pretending an existing blocked wallet is absent', async () => {
    await topup()
    expect(await reserveCredits(h.env, { email: OWNER, resId: 'old-hold', estMicro: 10_000_000, model: 'gpt-5-mini', modality: 'text' })).toEqual({ status: 'reserved' })
    await claim()
    const background: Promise<unknown>[] = []
    const start = await beginWalletBilling(h.env, promise => { background.push(promise); void promise.catch(() => {}) },
      { email: OWNER, model: 'gpt-5-mini', provider: 'openai', body: { messages: [], max_tokens: 1 } })
    try {
      expect(start.mode).toBe('refuse')
      if (start.mode !== 'refuse') throw new Error('Expected terminal refusal')
      expect(start.response.status).toBe(409)
      expect(await start.response.json()).toEqual({ error: 'wallet_reconciliation_pending' })
    } finally { await Promise.allSettled(background) }
    expect(await h.db.prepare('SELECT COUNT(*) AS count FROM reservation').first()).toEqual({ count: 1 })
    expect(await h.db.prepare("SELECT COUNT(*) AS count FROM credit_ledger WHERE kind='debit'").first()).toEqual({ count: 0 })
  })

  it('distinguishes a missing wallet from a read failure, without a false zero on the API', async () => {
    expect(await readWalletBalance(h.env, OWNER)).toEqual({ status: 'missing' })
    expect(await (await readApi()).json()).toEqual({ trialState: 'outside-trial', hasWallet: false, balanceMicro: 0, reservedMicro: 0, availableMicro: 0, reversalPending: false })
    const response = await onRequestGet({ env: { ...h.env, DB: undefined }, request: new Request('https://tryarty.com/api/wallet/balance',
      { headers: { 'x-google-token': 'synthetic-owner-token' } }) } as never)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'wallet_temporarily_unavailable' })
  })

  it('does not recommend buying credits when a refused hold is followed by a resolved refund and sufficient funds', async () => {
    await topup()
    const holdStatements = new WeakSet<D1PreparedStatement>()
    let injected = false
    const db = new Proxy(h.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        const statement = target.prepare(sql)
        if (!sql.trimStart().startsWith('INSERT INTO reservation')) return statement
        return { bind: (...values: unknown[]) => {
          const bound = statement.bind(...values); holdStatements.add(bound); return bound
        } }
      }
      if (key === 'batch') return async (statements: D1PreparedStatement[]) => {
        if (injected || !statements.some(statement => holdStatements.has(statement))) return target.batch(statements)
        injected = true
        await claim()
        const refused = await target.batch(statements)
        expect(refused[1].meta.changes).toBe(0)
        expect(await resolveWalletReversalsForTopup(h.env, { provider: 'creem', orderId: 'order-a',
          email: OWNER, topupMicro: 10_000_000 })).toEqual({ status: 'credited' })
        return refused
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const background: Promise<unknown>[] = []
    const start = await beginWalletBilling({ ...h.env, DB: db }, promise => { background.push(promise); void promise.catch(() => {}) },
      { email: OWNER, model: 'gpt-5-mini', provider: 'openai', body: { messages: [], max_tokens: 1 } })
    try {
      expect(injected).toBe(true); expect(start.mode).toBe('refuse')
      if (start.mode !== 'refuse') throw new Error('Expected transient refusal')
      expect(start.response.status).toBe(503)
      expect(await start.response.json()).toEqual({ error: 'wallet_temporarily_unavailable' })
    } finally { await Promise.allSettled(background) }
    expect(await getWalletBalance(h.env, OWNER)).toMatchObject({ availableMicro: 7_500_000, reversalPending: false })
    expect(await h.db.prepare('SELECT COUNT(*) AS count FROM reservation').first()).toEqual({ count: 0 })
  })
})
