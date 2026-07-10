// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import {
  creditWallet,
  debitWalletForReversal,
  getWalletBalance,
  reserveCredits,
  settleCredits,
  voidReservation,
} from '../../../functions/api/_lib/wallet'

const MODEL = 'claude-opus-4-8'
const ZERO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  audioSeconds: 0,
}

let harness: D1Harness
beforeAll(async () => { harness = await makeD1Harness() })
afterAll(async () => { await harness.dispose() })
beforeEach(async () => { await harness.reset() })

describe('wallet billing fail-closed invariants', () => {
  it('charges the full reservation when provider usage is absent', async () => {
    const email = 'unknown-usage@example.test'
    await creditWallet(harness.env, {
      provider: 'creem',
      eventId: 'unknown-topup',
      email,
      amountMicro: 1_000_000,
    })
    await reserveCredits(harness.env, {
      email,
      estMicro: 400_000,
      resId: 'unknown-reservation',
      model: MODEL,
      modality: 'text',
    })

    const result = await settleCredits(harness.env, {
      resId: 'unknown-reservation',
      email,
      model: MODEL,
      modality: 'text',
      usage: ZERO_USAGE,
      usageMeasured: false,
    })

    expect(result).toEqual({ status: 'settled', chargedMicro: 400_000 })
    expect(await getWalletBalance(harness.env, email)).toMatchObject({
      balanceMicro: 600_000,
      reservedMicro: 0,
    })
    const ledger = await harness.db.prepare(
      `SELECT amount_micro, provider_cost_micro, meta FROM credit_ledger
       WHERE ref_id = 'unknown-reservation' AND kind = 'debit'`,
    ).first<{ amount_micro: number; provider_cost_micro: number | null; meta: string }>()
    expect(ledger?.amount_micro).toBe(-400_000)
    expect(ledger?.provider_cost_micro).toBeNull()
    expect(JSON.parse(ledger!.meta)).toMatchObject({
      usageMeasured: false,
      fallback: 'full_reservation',
    })
  })

  it('never lets balance_micro become negative if a legacy hold is too small', async () => {
    const email = 'under-reserved@example.test'
    await creditWallet(harness.env, {
      provider: 'creem',
      eventId: 'under-topup',
      email,
      amountMicro: 100_000,
    })
    await reserveCredits(harness.env, {
      email,
      estMicro: 50_000,
      resId: 'under-reservation',
      model: MODEL,
      modality: 'text',
    })

    await settleCredits(harness.env, {
      resId: 'under-reservation',
      email,
      model: MODEL,
      modality: 'text',
      usage: { ...ZERO_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 },
      usageMeasured: true,
    })

    expect(await getWalletBalance(harness.env, email)).toMatchObject({
      balanceMicro: 0,
      reservedMicro: 0,
      availableMicro: 0,
    })
    const ledger = await harness.db.prepare(
      `SELECT amount_micro, balance_after FROM credit_ledger
       WHERE ref_id = 'under-reservation' AND kind = 'debit'`,
    ).first<{ amount_micro: number; balance_after: number }>()
    expect(ledger).toMatchObject({ amount_micro: -100_000, balance_after: 0 })
  })

  it('rejects invalid reservation amounts before touching D1', async () => {
    expect((await reserveCredits(harness.env, {
      email: 'invalid@example.test',
      estMicro: -1,
      resId: 'invalid-reservation',
      model: MODEL,
      modality: 'text',
    })).status).toBe('insufficient')
  })

  it('never consumes credits held by another concurrent reservation', async () => {
    const email = 'concurrent-holds@example.test'
    await creditWallet(harness.env, {
      provider: 'creem', eventId: 'concurrent-topup', email, amountMicro: 100_000,
    })
    await reserveCredits(harness.env, {
      email, estMicro: 40_000, resId: 'reservation-a', model: MODEL, modality: 'text',
    })
    await reserveCredits(harness.env, {
      email, estMicro: 40_000, resId: 'reservation-b', model: MODEL, modality: 'text',
    })

    const first = await settleCredits(harness.env, {
      resId: 'reservation-a', email, model: MODEL, modality: 'text',
      usage: { ...ZERO_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 },
      usageMeasured: true,
    })
    expect(first).toEqual({ status: 'settled', chargedMicro: 60_000 })
    expect(await getWalletBalance(harness.env, email)).toMatchObject({
      balanceMicro: 40_000, reservedMicro: 40_000, availableMicro: 0,
    })

    const second = await settleCredits(harness.env, {
      resId: 'reservation-b', email, model: MODEL, modality: 'text',
      usage: ZERO_USAGE, usageMeasured: false,
    })
    expect(second).toEqual({ status: 'settled', chargedMicro: 40_000 })
    expect(await getWalletBalance(harness.env, email)).toMatchObject({
      balanceMicro: 0, reservedMicro: 0, availableMicro: 0,
    })
  })

  it('caps concurrent Creem reversals atomically at the original top-up', async () => {
    const email = 'concurrent-refunds@example.test'
    const orderId = 'order-concurrent-refunds'
    await creditWallet(harness.env, {
      provider: 'creem', eventId: 'topup-concurrent-refunds', orderId,
      email, amountMicro: 10_000_000,
    })

    const results = await Promise.all([
      debitWalletForReversal(harness.env, {
        provider: 'creem', eventId: 'refund-concurrent-a', orderId, email,
        requestedDebitMicro: 6_000_000, maxCumulativeDebitMicro: 10_000_000,
        kind: 'refund',
      }),
      debitWalletForReversal(harness.env, {
        provider: 'creem', eventId: 'refund-concurrent-b', orderId, email,
        requestedDebitMicro: 6_000_000, maxCumulativeDebitMicro: 10_000_000,
        kind: 'refund',
      }),
    ])
    expect(results.every((result) => result.status === 'credited')).toBe(true)
    expect(await getWalletBalance(harness.env, email)).toMatchObject({ balanceMicro: 0 })
    const claimed = await harness.db.prepare(
      `SELECT SUM(requested_micro) AS amount_micro FROM wallet_reversal
       WHERE provider = 'creem' AND order_id = ?1 AND kind = 'refund'`,
    ).bind(orderId).first<{ amount_micro: number }>()
    expect(claimed?.amount_micro).toBe(10_000_000)
  })

  it('keeps the uncollectable reversal outstanding across concurrent AI holds', async () => {
    const email = 'reserved-refund@example.test'
    const orderId = 'order-reserved-refund'
    await creditWallet(harness.env, {
      provider: 'creem', eventId: 'topup-reserved-refund', orderId,
      email, amountMicro: 10_000_000,
    })
    await reserveCredits(harness.env, {
      email,
      estMicro: 4_000_000,
      resId: 'reservation-protecting-refund-a',
      model: MODEL,
      modality: 'text',
    })
    await reserveCredits(harness.env, {
      email,
      estMicro: 4_000_000,
      resId: 'reservation-protecting-refund-b',
      model: MODEL,
      modality: 'text',
    })

    expect((await debitWalletForReversal(harness.env, {
      provider: 'creem', eventId: 'refund-behind-hold', orderId, email,
      requestedDebitMicro: 10_000_000,
      maxCumulativeDebitMicro: 10_000_000,
      kind: 'refund',
    })).status).toBe('credited')

    expect(await getWalletBalance(harness.env, email)).toMatchObject({
      balanceMicro: 8_000_000,
      reservedMicro: 8_000_000,
      availableMicro: 0,
    })
    expect(await harness.db.prepare(
      `SELECT requested_micro, collected_micro, status FROM wallet_reversal
       WHERE provider = 'creem' AND event_id = 'refund-behind-hold'`,
    ).first()).toMatchObject({
      requested_micro: 10_000_000,
      collected_micro: 2_000_000,
      status: 'pending',
    })

    expect((await voidReservation(
      harness.env,
      'reservation-protecting-refund-a',
      email,
    )).status).toBe('voided')
    expect(await getWalletBalance(harness.env, email)).toMatchObject({
      balanceMicro: 4_000_000,
      reservedMicro: 4_000_000,
      availableMicro: 0,
    })
    expect(await harness.db.prepare(
      `SELECT requested_micro, collected_micro, status FROM wallet_reversal
       WHERE provider = 'creem' AND event_id = 'refund-behind-hold'`,
    ).first()).toMatchObject({
      requested_micro: 10_000_000,
      collected_micro: 6_000_000,
      status: 'pending',
    })

    expect((await voidReservation(
      harness.env,
      'reservation-protecting-refund-b',
      email,
    )).status).toBe('voided')
    expect(await getWalletBalance(harness.env, email)).toMatchObject({
      balanceMicro: 0,
      reservedMicro: 0,
      availableMicro: 0,
    })
    expect(await harness.db.prepare(
      `SELECT requested_micro, collected_micro, status FROM wallet_reversal
       WHERE provider = 'creem' AND event_id = 'refund-behind-hold'`,
    ).first()).toMatchObject({
      requested_micro: 10_000_000,
      collected_micro: 10_000_000,
      status: 'settled',
    })
    const ledger = await harness.db.prepare(
      `SELECT COUNT(*) AS n, SUM(amount_micro) AS total
       FROM credit_ledger WHERE kind = 'refund' AND ref_type = 'mor_reversal'`,
    ).first<{ n: number; total: number }>()
    expect(ledger).toMatchObject({ n: 3, total: -10_000_000 })
  })
})
