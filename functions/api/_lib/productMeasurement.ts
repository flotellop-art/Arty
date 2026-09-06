import { PRODUCT_MEASUREMENT_DAILY_CAP, PRODUCT_MEASUREMENT_OUTCOMES, type ProductMeasurementOutcome } from '../../../src/services/productMeasurementProtocol'

// A single bounded row per UTC day: no individual identity or event journal.
export const PRODUCT_MEASUREMENT_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS product_measurement_client_reply_v1 (
  day TEXT PRIMARY KEY NOT NULL CHECK (typeof(day) = 'text' AND length(day) = 10 AND date(day, '+0 days') IS day),
  ${PRODUCT_MEASUREMENT_OUTCOMES.map(key => `${key} INTEGER NOT NULL DEFAULT 0 CHECK(typeof(${key}) = 'integer' AND ${key} BETWEEN 0 AND ${PRODUCT_MEASUREMENT_DAILY_CAP})`).join(',\n  ')},
  total INTEGER NOT NULL CHECK(typeof(total) = 'integer' AND total BETWEEN 1 AND ${PRODUCT_MEASUREMENT_DAILY_CAP}
    AND total = saved + empty + error + stopped + not_saved + not_started)
)`

/** One atomic admission AND increment. No reservation, asynchronous cleanup,
 * replay or fail-open quota helper; a lost ack must not trigger a retry. */
export async function recordProductMeasurement(db: D1Database, outcome: ProductMeasurementOutcome): Promise<boolean> {
  if (!PRODUCT_MEASUREMENT_OUTCOMES.includes(outcome)) throw new Error('measurement_invalid')
  await db.prepare(PRODUCT_MEASUREMENT_SCHEMA_SQL).run()
  const counters = PRODUCT_MEASUREMENT_OUTCOMES.map(key => key === outcome ? 1 : 0)
  const result = await db.prepare(`INSERT INTO product_measurement_client_reply_v1
    (day, ${PRODUCT_MEASUREMENT_OUTCOMES.join(', ')}, total)
    VALUES (date('now'), ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(day) DO UPDATE SET
      ${PRODUCT_MEASUREMENT_OUTCOMES.map(key => `${key} = ${key} + excluded.${key}`).join(', ')}, total = total + 1
    WHERE total < ${PRODUCT_MEASUREMENT_DAILY_CAP} RETURNING 1 AS accepted`).bind(...counters).first<{ accepted: number }>()
  return result?.accepted === 1
}
