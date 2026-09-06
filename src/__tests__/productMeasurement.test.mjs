// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SCHEMA, OUTCOMES, measurementSQL, validateAggregate, parseAggregate, renderMeasurement } from '../../scripts/lib/productMeasurement.mjs'
const day = { day: '2026-09-05', saved: 1, empty: 0, error: 1, stopped: 0, not_saved: 0, not_started: 0, total: 2 }
const sample = (days = [day]) => ({ schema: SCHEMA, period_from: '2026-09-01', period_to: '2026-09-07', snapshot_utc: '2026-09-06 12:00:00', days_json: JSON.stringify(days) })
describe('optional product declarations report, not cohorts or users', () => {
  it('only emits one read-only canonical bounded SQL', () => {
    const sql = measurementSQL('2026-09-01', '2026-10-01')
    expect(sql).toContain('LIMIT 32'); expect(sql.match(/;/g)).toHaveLength(1)
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA)\b/i)
    for (const [from, to] of [['2026-02-30', '2026-03-02'], ['2026-09-01', '2026-11-01'], ["';DELETE", '2026-10-01']]) expect(() => measurementSQL(from, to)).toThrow()
  })
  it.each(['fr', 'en'])('retains real zero categories without inferring empty days or success rates (%s)', locale => {
    const input = sample(), report = JSON.parse(renderMeasurement(input, 'json', locale))
    expect(report.totals.empty).toBe(0); expect(report.days).toHaveLength(1); expect(report.totals.total).toBe(2)
    for (const format of ['html', 'csv', 'json']) {
      const text = renderMeasurement(sample([]), format, locale)
      expect(text).toContain(locale === 'fr' ? 'usage réel inconnu' : 'actual use is unknown')
      expect(text).toContain('D7/D30')
    }
  })
  it('accepts only a single successful Wrangler query envelope with one row', () => {
    expect(parseAggregate(JSON.stringify([{ success: true, results: [sample()], meta: { rows_read: 1 } }]))).toEqual(validateAggregate(sample()))
    for (const value of [[], [{ success: false, results: [sample()] }], [{ success: true, results: [] }], [{ success: true, results: [sample(), sample()] }], { email: 'PRIVATE' }]) expect(() => parseAggregate(JSON.stringify(value))).toThrow()
    expect(() => parseAggregate(' '.repeat(65_537))).toThrow()
    expect(() => parseAggregate(renderMeasurement(sample(), 'json'))).toThrow()
  })
  it.each([
    { ...day, saved: 1.2 }, { ...day, saved: -1 }, { ...day, saved: '1' }, { ...day, total: 3 }, { ...day, saved: 10_001, total: 10_002 },
    { ...day, day: '2026-09-07' }, { ...day, day: '2026-09-00' }, { ...day, private: 'PRIVATE' },
  ])('rejects incoherent or unrecognized row %j', row => { expect(() => validateAggregate(sample([row]))).toThrow() })
  it('rejects duplicate days, ambiguous schemas and future rows', () => {
    expect(() => validateAggregate(sample([day, day]))).toThrow()
    expect(() => validateAggregate({ ...sample(), private: 'PRIVATE' })).toThrow()
    expect(() => validateAggregate({ ...sample(), snapshot_utc: '2026-02-30 12:00:00' })).toThrow()
    expect(() => validateAggregate({ ...sample(), snapshot_utc: '2026-09-04 12:00:00' })).toThrow()
  })
  it('marks a saturated day and emits a script-free responsive HTML without external resources', () => {
    const input = sample([{ ...day, saved: 9_999, total: 10_000 }])
    expect(JSON.parse(renderMeasurement(input, 'json')).capDays).toBe(1)
    const html = renderMeasurement(input, 'html')
    expect(html).toContain('name="viewport"'); expect(html).toContain('overflow:auto')
    expect(html).not.toMatch(/<script|https?:\/\/|onclick|<iframe|<img/)
    expect(OUTCOMES).toHaveLength(6)
  })
})
