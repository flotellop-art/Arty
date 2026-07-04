// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import {
  creditWallet,
  getWalletBalance,
  reserveCredits,
  settleCredits,
  voidReservation,
} from '../../../functions/api/_lib/wallet'

// Zone 3 (C8/F-5) — wallet atomique : crédit idempotent par webhook_event,
// réserve/settle/void sans double-débit ni solde négatif.
const MODEL = 'claude-sonnet-4-6'
const USAGE = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 }

let h: D1Harness
beforeAll(async () => { h = await makeD1Harness() })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset() })

describe('creditWallet — idempotence webhook (zone 3)', () => {
  it('crédite une fois, puis dédoublonne sur (provider, event_id)', async () => {
    const email = 'c@x.io'
    const p = { provider: 'creem', eventId: 'evt_1', orderId: 'ord_1', email, amountMicro: 1_000_000, kind: 'topup' as const }
    expect((await creditWallet(h.env, p)).status).toBe('credited')
    expect((await getWalletBalance(h.env, email))!.balanceMicro).toBe(1_000_000)
    // Rejeu du MÊME event → duplicate, aucun double-crédit
    expect((await creditWallet(h.env, p)).status).toBe('duplicate')
    expect((await getWalletBalance(h.env, email))!.balanceMicro).toBe(1_000_000)
  })
})

describe('reserve / settle / void (zone 3)', () => {
  it('réserve dans la limite du solde, refuse au-delà, jamais négatif', async () => {
    const email = 'r@x.io'
    await creditWallet(h.env, { provider: 'creem', eventId: 'e1', email, amountMicro: 1_000_000 })
    expect((await reserveCredits(h.env, { email, estMicro: 400_000, resId: 'r1', model: MODEL, modality: 'text' })).status).toBe('reserved')
    let bal = (await getWalletBalance(h.env, email))!
    expect(bal.reservedMicro).toBe(400_000)
    expect(bal.availableMicro).toBe(600_000)
    // au-delà du disponible → insufficient, wallet inchangé
    expect((await reserveCredits(h.env, { email, estMicro: 1_000_000, resId: 'r2', model: MODEL, modality: 'text' })).status).toBe('insufficient')
    bal = (await getWalletBalance(h.env, email))!
    expect(bal.reservedMicro).toBe(400_000)
    expect(bal.balanceMicro).toBe(1_000_000)
    expect(bal.availableMicro).toBeGreaterThanOrEqual(0)
  })

  it('settle débite le coût réel et libère le hold ; re-settle = no-op (pas de double-débit)', async () => {
    const email = 's@x.io'
    await creditWallet(h.env, { provider: 'creem', eventId: 'e2', email, amountMicro: 1_000_000 })
    await reserveCredits(h.env, { email, estMicro: 500_000, resId: 'sr', model: MODEL, modality: 'text' })
    const r = await settleCredits(h.env, { resId: 'sr', email, model: MODEL, modality: 'text', usage: USAGE })
    expect(r.status).toBe('settled')
    const after = (await getWalletBalance(h.env, email))!
    expect(after.reservedMicro).toBe(0)                 // hold libéré
    expect(after.balanceMicro).toBeLessThan(1_000_000)  // débit réel appliqué
    expect(after.balanceMicro).toBeGreaterThan(0)       // jamais négatif
    // idempotence : re-settle ne re-débite PAS
    const r2 = await settleCredits(h.env, { resId: 'sr', email, model: MODEL, modality: 'text', usage: USAGE })
    expect(r2.status).toBe('already_finalized')
    expect((await getWalletBalance(h.env, email))!.balanceMicro).toBe(after.balanceMicro)
  })

  it('void rend le hold intégralement ; re-void = no-op', async () => {
    const email = 'v@x.io'
    await creditWallet(h.env, { provider: 'creem', eventId: 'e3', email, amountMicro: 1_000_000 })
    await reserveCredits(h.env, { email, estMicro: 300_000, resId: 'vr', model: MODEL, modality: 'text' })
    expect((await voidReservation(h.env, 'vr', email)).status).toBe('voided')
    const after = (await getWalletBalance(h.env, email))!
    expect(after.reservedMicro).toBe(0)
    expect(after.balanceMicro).toBe(1_000_000) // rien débité sur un void
    expect((await voidReservation(h.env, 'vr', email)).status).toBe('already_finalized')
  })
})
