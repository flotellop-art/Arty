// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { creditWallet, reserveCredits, settleCredits } from '../../../functions/api/_lib/wallet'
import { measurementSQL, renderMeasurement, validateAggregate } from '../../../scripts/lib/walletMeasurement.mjs'

let harness: D1Harness
beforeAll(async () => { harness = await makeD1Harness() })
afterAll(async () => { await harness.dispose() })

describe('wallet measurement with the actual writer and isolated D1 engine', () => {
  it('preserves writer zero, unknown reservation and capped negative difference in one snapshot', async () => {
    const zeroUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, audioSeconds: 0 }
    for (const [id, balance, measured, usage] of [
      ['zero', 1_000_000, true, zeroUsage],
      ['unknown', 1_000_000, false, zeroUsage],
      ['capped', 100_000, true, { ...zeroUsage, inputTokens: 1_000_000, outputTokens: 1_000_000 }],
    ] as const) {
      const email = `${id}-PRIVATE-CANARY@example.test`, model = 'claude-opus-4-8'
      await creditWallet(harness.env, { email, provider: 'creem', eventId: id + '-topup', amountMicro: balance })
      const reserved = await reserveCredits(harness.env, { email, estMicro: 50_000, resId: id, model, modality: 'text' })
      expect(reserved.status).toBe('reserved')
      expect((await settleCredits(harness.env, { email, resId: id, model, modality: 'text', usageMeasured: measured, usage })).status).toBe('settled')
    }
    // Freeze only synthetic ledger dates; the amounts and metadata came from the writer.
    await harness.db.prepare("UPDATE credit_ledger SET created_at = '2026-09-05 12:00:00'").run()
    const result = await harness.db.prepare(measurementSQL('2026-09-01', '2026-10-01')).first()
    const row = validateAggregate(result)
    expect(row).toMatchObject({ source_rows: 6, measured_rows: 2, unknown_rows: 1, legacy_rows: 0, inconsistent_rows: 0, other_rows: 3, invalid_date_rows: 0 })
    const totals = await harness.db.prepare(`SELECT CAST(SUM(-amount_micro) AS TEXT) AS debit, CAST(SUM(provider_cost_micro) AS TEXT) AS cost
      FROM credit_ledger WHERE kind = 'debit' AND ref_id IN ('zero', 'capped')`).first<{ debit: string; cost: string }>()
    expect(row.measured_debit_micro).toBe(totals!.debit)
    expect(row.measured_cost_micro).toBe(totals!.cost)
    const json = JSON.parse(renderMeasurement(row, 'json', 'fixture'))
    expect(json.technicalDifferenceMicro).toBeLessThan(0)
    for (const format of ['html', 'csv', 'json']) {
      const output = renderMeasurement(row, format, 'fixture')
      expect(output).not.toMatch(/PRIVATE-CANARY|example\.test|claude-opus|ref_id/)
    }
  })
})
