/**
 * Documentary observations ONLY. These are neither subscription authority nor
 * ledger entries. A provider invoice/customer reference does not prove an Arty
 * account, product or environment. Never join by email or project into rights.
 */
export type LemonInvoiceEvent =
  | 'subscription_payment_success'
  | 'subscription_payment_failed'
  | 'subscription_payment_recovered'
  | 'subscription_payment_refunded'

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function providerId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  return typeof value === 'string' && /^[1-9]\d{0,39}$/.test(value) ? value : null
}

function minorAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function booleanFlag(value: unknown): number | null {
  return typeof value === 'boolean' ? Number(value) : null
}

/** Keep the provider's exact precision/offset. Never use this as a rights clock. */
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return null
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] ? value : null
}

const INVOICE_STATUSES = new Set(['pending', 'paid', 'void', 'refunded', 'partial_refund'])

/** Caller must first authenticate these exact bytes and validate event/data.type. */
export async function captureLemonInvoice(
  db: D1Database, event: LemonInvoiceEvent, data: unknown, authenticatedBody: ArrayBuffer,
): Promise<void> {
  const object = record(data), attrs = record(object.attributes)
  const invoiceId = providerId(object.id)
  const subscriptionId = providerId(attrs.subscription_id)
  const storeId = providerId(attrs.store_id)
  const customerId = providerId(attrs.customer_id)
  const testMode = booleanFlag(attrs.test_mode)
  const status = typeof attrs.status === 'string' && INVOICE_STATUSES.has(attrs.status) ? attrs.status : null
  const currency = typeof attrs.currency === 'string' && /^[A-Z]{3}$/.test(attrs.currency) ? attrs.currency : null
  const total = minorAmount(attrs.total), refundedAmount = minorAmount(attrs.refunded_amount)
  const refunded = booleanFlag(attrs.refunded)
  const refundedAt = timestamp(attrs.refunded_at)
  const updatedAt = timestamp(attrs.updated_at)

  // Fixed field names only: invalid/unexpected provider content is not persisted.
  const reasons = [
    [invoiceId, 'invoice_id'], [subscriptionId, 'subscription_id'], [storeId, 'store_id'],
    [customerId, 'customer_id'], [testMode, 'test_mode'], [status, 'status'], [currency, 'currency'],
    [total, 'total'], [refundedAmount, 'refunded_amount'], [refunded, 'refunded'], [updatedAt, 'updated_at'],
  ].filter(([value]) => value === null).map(([, name]) => name as string)
  if (attrs.refunded_at !== null && refundedAt === null) reasons.push('refunded_at')
  if (refundedAmount !== null && total !== null && refundedAmount > total) reasons.push('refund_exceeds_total')
  if (refunded === 1 && refundedAt === null && !reasons.includes('refunded_at')) reasons.push('refunded_at')

  // No provider notification ID is promised. Exact signed-body replay is the
  // only deduplication claim. Different revisions, events, scopes or serializations
  // remain separate observations, even at the same timestamp. Never SUM receipts.
  const digest = await crypto.subtle.digest('SHA-256', authenticatedBody)
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const result = await db.prepare(`INSERT INTO lemon_invoice_receipt_v1 (
    receipt_hash, event_name, invoice_id, subscription_id, store_id, customer_id,
    test_mode, invoice_status, currency, total_minor, refunded_minor, refunded,
    provider_refunded_at, provider_updated_at, outcome, reason
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
    ON CONFLICT(receipt_hash) DO NOTHING`)
    .bind(hash, event, invoiceId, subscriptionId, storeId, customerId, testMode, status,
      currency, total, refundedAmount, refunded, refundedAt, updatedAt,
      reasons.length ? 'review' : 'captured', reasons.length ? reasons.join(',') : null)
    .run()
  if (!result.success) throw new Error('Invoice receipt persistence failed')
  const saved = await db.prepare('SELECT receipt_hash FROM lemon_invoice_receipt_v1 WHERE receipt_hash = ?1')
    .bind(hash).first<{ receipt_hash: string }>()
  if (saved?.receipt_hash !== hash) throw new Error('Invoice receipt not confirmed')
}
