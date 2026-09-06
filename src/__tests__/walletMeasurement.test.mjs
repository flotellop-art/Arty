// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { measurementSQL, parseAggregate, renderMeasurement, ROW_LIMIT, validateAggregate, validateWindow } from '../../scripts/lib/walletMeasurement.mjs'

const databases = []
const from = '2026-09-01', to = '2026-10-01'
function fixture() {
  const db = new DatabaseSync(':memory:')
  databases.push(db)
  db.exec(`CREATE TABLE credit_ledger (id INTEGER PRIMARY KEY, user_email TEXT, amount_micro INTEGER, provider_cost_micro INTEGER, kind TEXT, meta TEXT, created_at TEXT, model TEXT, ref_id TEXT)`)
  return db
}
function add(db, override = {}) {
  const row = { amount: -300_000, cost: 200_000, kind: 'debit', meta: '{"usageMeasured":true}', created: '2026-09-05 12:00:00', ...override }
  db.prepare('INSERT INTO credit_ledger(user_email, amount_micro, provider_cost_micro, kind, meta, created_at, model, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('PII-CANARY@example.test', row.amount, row.cost, row.kind, row.meta, row.created, 'PRIVATE-MODEL-CANARY', 'PRIVATE-REF-CANARY')
}
function query(db, start = from, end = to) { return db.prepare(measurementSQL(start, end)).get() }
afterEach(() => { for (const db of databases.splice(0)) db.close() })

describe('read-only wallet measurement on real SQLite', () => {
  it('partitions mixed rows and sums exactly the same measured subset', () => {
    const db = fixture()
    add(db); add(db, { cost: null, meta: '{"usageMeasured":false,"fallback":"full_reservation"}' })
    add(db, { meta: null }); add(db, { meta: '{"usageMeasured":"true"}' })
    add(db, { kind: 'topup', amount: 900 }); add(db, { created: '2026-08-31 23:59:59' }); add(db, { created: 'not a date' })
    db.exec('PRAGMA query_only=ON')
    const row = validateAggregate(query(db))
    expect(row).toMatchObject({ source_rows: 7, measured_rows: 1, unknown_rows: 1, legacy_rows: 1, inconsistent_rows: 1, other_rows: 1, outside_rows: 1, invalid_date_rows: 1, measured_debit_micro: '300000', measured_cost_micro: '200000' })
    for (const format of ['html', 'csv', 'json']) {
      const output = renderMeasurement(row, format, 'fixture')
      expect(output).not.toMatch(/PII-CANARY|PRIVATE-MODEL|PRIVATE-REF|user_email|ref_id|full_reservation/)
    }
    const report = JSON.parse(renderMeasurement(row, 'json', 'fixture'))
    expect(report).toMatchObject({ measuredDebitMicro: 300_000, measuredCostMicro: 200_000, technicalDifferenceMicro: 100_000, selectedDebitRows: 4 })
    for (const format of ['html', 'csv']) {
      const output = renderMeasurement(row, format, 'fixture')
      expect(output).toContain('0.300000 USD'); expect(output).toContain('0.200000 USD'); expect(output).toContain('0.100000 USD')
    }
    expect(renderMeasurement(row)).not.toMatch(/<script|<style|<link|<img|<form|https?:|onload=|onclick=/i)
  })

  it.each([
    ['unknown_rows', { meta: null, cost: null }],
    ['legacy_rows', { meta: null }], ['legacy_rows', { meta: '{}' }],
    ['unknown_rows', { meta: '{"usageMeasured":false}', cost: null }],
    ['unknown_rows', { meta: '{"usageMeasured":false,"fallback":"full_reservation"}', cost: null }],
    ['inconsistent_rows', { meta: '{"usageMeasured":true}', cost: null }],
    ['inconsistent_rows', { meta: '{"usageMeasured":true,"fallback":null}' }],
    ['inconsistent_rows', { meta: '{"usageMeasured":false}' }],
    ['inconsistent_rows', { meta: '{"usageMeasured":false,"fallback":"other"}', cost: null }],
    ['inconsistent_rows', { meta: '{"usageMeasured":1}' }], ['inconsistent_rows', { meta: '{"usageMeasured":"true"}' }],
    ['inconsistent_rows', { meta: '{"usageMeasured":null}' }], ['inconsistent_rows', { meta: 'null' }],
    ['inconsistent_rows', { meta: '[]' }], ['inconsistent_rows', { meta: '{invalid' }],
    ['inconsistent_rows', { meta: '{"usageMeasured":true,"usageMeasured":false}' }],
    ['inconsistent_rows', { meta: '{"usageMeasured":true,"x":1,"x":2}' }],
    ['inconsistent_rows', { meta: '{"usageMeasured\\u0000x":true,"usageMeasured":false}' }],
    ['inconsistent_rows', { meta: '{"usageMeasured":true,"x\\u0000y":1}' }],
    ['inconsistent_rows', { meta: JSON.stringify({ usageMeasured: true, text: 'x'.repeat(8192) }) }],
    ['inconsistent_rows', { meta: Buffer.from('{"usageMeasured":true}') }],
    ['inconsistent_rows', { cost: -1 }], ['inconsistent_rows', { cost: 0.5 }], ['inconsistent_rows', { cost: 'bad' }],
    ['inconsistent_rows', { amount: 1 }], ['inconsistent_rows', { amount: -0.5 }], ['inconsistent_rows', { amount: 'bad' }],
    ['inconsistent_rows', { amount: -9223372036854775808n }],
    ['other_rows', { kind: 'refund' }], ['other_rows', { kind: 'chargeback' }], ['other_rows', { kind: 'adjustment' }],
    ['other_rows', { kind: 'DEBIT' }], ['other_rows', { kind: null }],
  ])('classifies without coercion: %s (case %#)', (category, override) => {
    const db = fixture(); add(db, override)
    const row = validateAggregate(query(db))
    expect(row[category]).toBe(1)
    expect(row.measured_rows).toBe(0)
    const report = JSON.parse(renderMeasurement(row, 'json'))
    expect(report.measuredCostMicro).toBeNull(); expect(report.technicalDifferenceMicro).toBeNull()
  })

  it('distinguishes a real measured zero from an unknown cost', () => {
    const db = fixture(); add(db, { amount: 0, cost: 0 })
    const row = query(db)
    expect(JSON.parse(renderMeasurement(row, 'json')).measuredCostMicro).toBe(0)
    expect(renderMeasurement(row)).toContain('0.000000 USD')
  })

  it('allows a capped debit of zero and a negative technical difference', () => {
    const db = fixture(); add(db, { amount: 0, cost: 200_000 })
    expect(JSON.parse(renderMeasurement(query(db), 'json')).technicalDifferenceMicro).toBe(-200_000)
    expect(renderMeasurement(query(db), 'csv')).toContain('-0.200000 USD')
  })

  it('shows no measured amount for a successful empty query', () => {
    const row = query(fixture())
    expect(row.source_rows).toBe(0)
    expect(renderMeasurement(row)).toContain('Non disponible')
    expect(JSON.parse(renderMeasurement(row, 'json')).measuredDebitMicro).toBeNull()
  })

  it.each(['2026-02-30 12:00:00', '2026-09-31 00:00:00', '2026-09-05 24:00:00', '2026-09-05T12:00:00Z', '2026-09-05 12:00:00Z', '2026-09-05 12:00:00\u0000hidden', null, ''])('counts unassignable date %j globally', created => {
    const db = fixture(); add(db, { created })
    expect(validateAggregate(query(db))).toMatchObject({ invalid_date_rows: 1, measured_rows: 0, outside_rows: 0 })
  })

  it('includes the UTC start and excludes the exact end; accepts a leap day', () => {
    const db = fixture(); add(db, { created: '2024-02-29 00:00:00' }); add(db, { created: '2024-03-01 00:00:00' })
    expect(validateAggregate(query(db, '2024-02-29', '2024-03-01'))).toMatchObject({ measured_rows: 1, outside_rows: 1 })
  })

  it('does not mistake absent schema for zero', () => {
    const db = new DatabaseSync(':memory:'); databases.push(db)
    expect(() => query(db)).toThrow(/no such table/)
  })

  it('refuses a sum exceeding the exact JavaScript integer range', () => {
    const db = fixture(); add(db, { amount: -Number.MAX_SAFE_INTEGER, cost: 0 }); add(db, { amount: -1, cost: 0 })
    expect(query(db).measured_debit_micro).toBe('9007199254740992')
    expect(() => validateAggregate(query(db))).toThrow(/indisponible/)
  })

  it('surfaces SQLite INTEGER overflow instead of substituting a float or zero', () => {
    const db = fixture()
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1025)
      INSERT INTO credit_ledger(amount_micro,provider_cost_micro,kind,meta,created_at)
      SELECT -9007199254740991,0,'debit','{"usageMeasured":true}','2026-09-05 12:00:00' FROM n`)
    expect(() => query(db)).toThrow(/integer overflow/)
  })

  it('accepts exactly 100000 global rows and refuses 100001, even outside the period', () => {
    const db = fixture()
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<${ROW_LIMIT})
      INSERT INTO credit_ledger(kind,created_at) SELECT 'topup','2026-01-01 00:00:00' FROM n`)
    expect(validateAggregate(query(db)).source_rows).toBe(ROW_LIMIT)
    add(db)
    expect(() => validateAggregate(query(db))).toThrow(/capacité/)
  })

  it('classifies a dense measured ledger once into small materialized scalars', () => {
    const db = fixture()
    db.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<${ROW_LIMIT})
      INSERT INTO credit_ledger(amount_micro,provider_cost_micro,kind,meta,created_at)
      SELECT -3,2,'debit','{"input":5,"output":3,"cacheRead":0,"cacheCreation":0,"usageMeasured":true}','2026-09-05 12:00:00' FROM n`)
    expect(measurementSQL(from, to)).toContain('classified AS MATERIALIZED')
    const row = validateAggregate(query(db))
    expect(row).toMatchObject({ measured_rows: ROW_LIMIT, measured_debit_micro: '300000', measured_cost_micro: '200000' })
  }, 20_000)

  it.each([['2026-02-30', '2026-03-02'], ['2026-09-01', '2026-09-01'], ['2026-10-01', '2026-09-01'], ['2026-09-01', '2026-10-03'], ["2026-09-01'; DROP TABLE credit_ledger;--", to]])('rejects invalid window %s %s before SQL', (start, end) => {
    expect(() => validateWindow(start, end)).toThrow(/indisponible/)
    expect(() => measurementSQL(start, end)).toThrow(/indisponible/)
  })

  it('validates imports and revalidates every render without leaking rejected fields', () => {
    const db = fixture(); add(db)
    const row = query(db)
    expect(parseAggregate(JSON.stringify([{ success: true, results: [row], meta: { rows_read: 1 } }]))).toEqual(row)
    const invalid = [null, [{ success: false, results: [row] }], [{ success: true, results: [] }], { ...row, measured_rows: 2 }, { ...row, source_rows: 0 }, { ...row, measured_cost_micro: 200000 }, { ...row, measured_cost_micro: '01' }, { ...row, snapshot_utc: '2026-02-30 00:00:00' }, { ...row, user_email: 'PRIVATE' }]
    for (const value of invalid) expect(() => parseAggregate(JSON.stringify(value))).toThrow(/indisponible/)
    for (const format of ['html', 'csv', 'json']) expect(() => renderMeasurement({ ...row, source_rows: -1 }, format)).toThrow(/indisponible/)
    expect(() => parseAggregate('x'.repeat(65_537))).toThrow(/indisponible/)
    expect(() => renderMeasurement(row, 'html', 'live')).toThrow(/indisponible/)
  })
})
