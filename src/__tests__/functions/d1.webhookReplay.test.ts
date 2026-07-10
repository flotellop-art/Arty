// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { creditWallet, getWalletBalance } from '../../../functions/api/_lib/wallet'
import { onRequestPost as creemWebhook } from '../../../functions/api/webhook/creem'
import { onRequestPost as lemonSqueezyWebhook } from '../../../functions/api/webhook/lemonsqueezy'
import { makeD1Harness, type D1Harness } from './d1Harness'

const CREEM_SECRET = 'creem-test-secret'
const LEMON_SQUEEZY_SECRET = 'lemon-squeezy-test-secret'

let h: D1Harness

beforeAll(async () => {
  h = await makeD1Harness({
    CREEM_WEBHOOK_SECRET: CREEM_SECRET,
    CREEM_CREDITS_10_PRODUCT_ID: 'prod_5ba1P24WLXkcXUnbZytWm7',
    LEMONSQUEEZY_WEBHOOK_SECRET: LEMON_SQUEEZY_SECRET,
  })
})
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset() })

async function hmacHex(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function postSignedWebhook(
  handler: typeof creemWebhook | typeof lemonSqueezyWebhook,
  url: string,
  signatureHeader: string,
  secret: string,
  payload: unknown,
): Promise<Response> {
  const body = JSON.stringify(payload)
  const request = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [signatureHeader]: await hmacHex(body, secret),
    },
    body,
  })
  return handler({ request, env: h.env } as never)
}

describe('webhook Creem — remboursements partiels', () => {
  it('reprend les crédits au prorata et déduplique le replay du même event', async () => {
    const email = 'refund@example.com'
    const orderId = 'ord_partial_refund'
    await creditWallet(h.env, {
      provider: 'creem',
      eventId: 'evt_checkout',
      orderId,
      email,
      amountMicro: 10_000_000,
      kind: 'topup',
    })

    // Format documenté par Creem : l'order id est dans transaction.order,
    // refund_amount et amount_paid sont exprimés dans la même devise.
    const payload = {
      id: 'evt_refund_25_percent',
      eventType: 'refund.created',
      object: {
        id: 'ref_25_percent',
        status: 'succeeded',
        refund_amount: 250,
        refund_currency: 'EUR',
        transaction: {
          amount_paid: 1_000,
          order: orderId,
        },
      },
    }

    const first = await postSignedWebhook(
      creemWebhook,
      'https://tryarty.com/api/webhook/creem',
      'creem-signature',
      CREEM_SECRET,
      payload,
    )
    expect(first.status).toBe(200)
    expect((await getWalletBalance(h.env, email))?.balanceMicro).toBe(7_500_000)

    const replay = await postSignedWebhook(
      creemWebhook,
      'https://tryarty.com/api/webhook/creem',
      'creem-signature',
      CREEM_SECRET,
      payload,
    )
    expect(replay.status).toBe(200)
    expect((await getWalletBalance(h.env, email))?.balanceMicro).toBe(7_500_000)

    const refunds = await h.db.prepare(
      `SELECT amount_micro FROM credit_ledger WHERE kind = 'refund' ORDER BY id`,
    ).all<{ amount_micro: number }>()
    expect(refunds.results).toEqual([{ amount_micro: -2_500_000 }])
  })

  it('ne retire jamais plus que le top-up initial sur plusieurs événements', async () => {
    const email = 'capped-refund@example.com'
    const orderId = 'ord_capped_refund'
    await creditWallet(h.env, {
      provider: 'creem',
      eventId: 'evt_checkout_capped',
      orderId,
      email,
      amountMicro: 10_000_000,
      kind: 'topup',
    })

    for (const [id, refundAmount] of [['evt_refund_a', 600], ['evt_refund_b', 600]] as const) {
      const response = await postSignedWebhook(
        creemWebhook,
        'https://tryarty.com/api/webhook/creem',
        'creem-signature',
        CREEM_SECRET,
        {
          id,
          eventType: 'refund.created',
          object: {
            refund_amount: refundAmount,
            transaction: { amount_paid: 1_000, order: orderId },
          },
        },
      )
      expect(response.status).toBe(200)
    }

    expect((await getWalletBalance(h.env, email))?.balanceMicro).toBe(0)
    const totalRefund = await h.db.prepare(
      `SELECT COALESCE(SUM(amount_micro), 0) AS amount_micro
       FROM credit_ledger WHERE kind = 'refund'`,
    ).first<{ amount_micro: number }>()
    expect(totalRefund?.amount_micro).toBe(-10_000_000)
  })

  it('conserve un refund livré avant checkout.completed puis le collecte au top-up', async () => {
    const email = 'refund-before-topup@example.com'
    const orderId = 'ord_refund_before_topup'
    const refundPayload = {
      id: 'evt_refund_before_topup',
      eventType: 'refund.created',
      object: {
        refund_amount: 250,
        transaction: { amount_paid: 1_000, order: orderId },
      },
    }

    const earlyRefund = await postSignedWebhook(
      creemWebhook,
      'https://tryarty.com/api/webhook/creem',
      'creem-signature',
      CREEM_SECRET,
      refundPayload,
    )
    expect(earlyRefund.status).toBe(200)
    expect(await h.db.prepare(
      `SELECT requested_micro, collected_micro, status FROM wallet_reversal
       WHERE provider = 'creem' AND event_id = 'evt_refund_before_topup'`,
    ).first()).toMatchObject({
      requested_micro: null,
      collected_micro: 0,
      status: 'awaiting_topup',
    })

    const checkout = await postSignedWebhook(
      creemWebhook,
      'https://tryarty.com/api/webhook/creem',
      'creem-signature',
      CREEM_SECRET,
      {
        id: 'evt_checkout_after_refund',
        eventType: 'checkout.completed',
        object: {
          order: {
            id: orderId,
            product: 'prod_5ba1P24WLXkcXUnbZytWm7',
            status: 'paid',
          },
          product: { id: 'prod_5ba1P24WLXkcXUnbZytWm7' },
          customer: { email },
          metadata: { app_user_email: email, pack: 'credits_10' },
        },
      },
    )
    expect(checkout.status).toBe(200)
    expect((await getWalletBalance(h.env, email))?.balanceMicro).toBe(7_500_000)
    expect(await h.db.prepare(
      `SELECT requested_micro, collected_micro, status FROM wallet_reversal
       WHERE provider = 'creem' AND event_id = 'evt_refund_before_topup'`,
    ).first()).toMatchObject({
      requested_micro: 2_500_000,
      collected_micro: 2_500_000,
      status: 'settled',
    })

    const replay = await postSignedWebhook(
      creemWebhook,
      'https://tryarty.com/api/webhook/creem',
      'creem-signature',
      CREEM_SECRET,
      refundPayload,
    )
    expect(replay.status).toBe(200)
    expect((await getWalletBalance(h.env, email))?.balanceMicro).toBe(7_500_000)
  })

  it('retourne 5xx si un checkout credits payé utilise un product id ayant tourné', async () => {
    const previousProductId = h.env.CREEM_CREDITS_10_PRODUCT_ID
    h.env.CREEM_CREDITS_10_PRODUCT_ID = 'prod_newEnvironmentProduct'
    try {
      const response = await postSignedWebhook(
        creemWebhook,
        'https://tryarty.com/api/webhook/creem',
        'creem-signature',
        CREEM_SECRET,
        {
          id: 'evt_checkout_rotated_product',
          eventType: 'checkout.completed',
          object: {
            order: {
              id: 'ord_checkout_rotated_product',
              product: 'prod_previousEnvironmentProduct',
              status: 'paid',
            },
            product: { id: 'prod_previousEnvironmentProduct' },
            customer: { email: 'rotation@example.com' },
            metadata: { app_user_email: 'rotation@example.com', pack: 'credits_10' },
          },
        },
      )

      expect(response.status).toBe(500)
      expect(await getWalletBalance(h.env, 'rotation@example.com')).toBeNull()
    } finally {
      h.env.CREEM_CREDITS_10_PRODUCT_ID = previousProductId
    }
  })
})

describe('webhook Lemon Squeezy — replay order_created', () => {
  it('conserve messages_used lorsqu’un achat de pack est rejoué', async () => {
    const payload = {
      meta: { event_name: 'order_created' },
      data: {
        id: 'ls_order_pack_1',
        type: 'orders',
        attributes: {
          user_email: 'Pack.User@Example.com',
          first_order_item: { product_id: 1004493 },
        },
      },
    }

    const first = await postSignedWebhook(
      lemonSqueezyWebhook,
      'https://tryarty.com/api/webhook/lemonsqueezy',
      'X-Signature',
      LEMON_SQUEEZY_SECRET,
      payload,
    )
    expect(first.status).toBe(200)
    await h.db.prepare(
      `UPDATE premium_packs SET messages_used = 37 WHERE ls_order_id = ?1`,
    ).bind('ls_order_pack_1').run()

    const replay = await postSignedWebhook(
      lemonSqueezyWebhook,
      'https://tryarty.com/api/webhook/lemonsqueezy',
      'X-Signature',
      LEMON_SQUEEZY_SECRET,
      payload,
    )
    expect(replay.status).toBe(200)

    const pack = await h.db.prepare(
      `SELECT user_email, messages_total, messages_used
       FROM premium_packs WHERE ls_order_id = ?1`,
    ).bind('ls_order_pack_1').first<{
      user_email: string
      messages_total: number
      messages_used: number
    }>()
    expect(pack).toEqual({
      user_email: 'pack.user@example.com',
      messages_total: 100,
      messages_used: 37,
    })

    const count = await h.db.prepare(
      `SELECT COUNT(*) AS count FROM premium_packs WHERE ls_order_id = ?1`,
    ).bind('ls_order_pack_1').first<{ count: number }>()
    expect(count?.count).toBe(1)
  })
})

describe('webhook Lemon Squeezy — état monotone des abonnements', () => {
  it('conserve le plan payé pendant la période de grâce cancelled', async () => {
    const email = 'cancelled@example.com'
    const endsAt = '2099-02-01T00:00:00.000Z'
    const response = await postSignedWebhook(
      lemonSqueezyWebhook,
      'https://tryarty.com/api/webhook/lemonsqueezy',
      'X-Signature',
      LEMON_SQUEEZY_SECRET,
      {
        meta: { event_name: 'subscription_cancelled' },
        data: {
          id: 'sub_cancelled_1',
          type: 'subscriptions',
          attributes: {
            user_email: email,
            status: 'cancelled',
            ends_at: endsAt,
            updated_at: '2026-07-09T10:00:00.000Z',
          },
        },
      },
    )
    expect(response.status).toBe(200)

    const row = await h.db.prepare(
      `SELECT plan_type, status, current_period_end FROM subscriptions WHERE user_email = ?1`,
    ).bind(email).first<{
      plan_type: string
      status: string
      current_period_end: string
    }>()
    expect(row).toEqual({
      plan_type: 'subscription',
      status: 'cancelled',
      current_period_end: endsAt,
    })
  })

  it('ignore un ancien event active livré après une expiration plus récente', async () => {
    const email = 'ordered@example.com'
    const event = (name: string, status: string, updatedAt: string) => ({
      meta: { event_name: name },
      data: {
        id: 'sub_ordered_1',
        type: 'subscriptions',
        attributes: {
          user_email: email,
          status,
          renews_at: '2026-08-01T00:00:00.000Z',
          ends_at: status === 'expired' ? '2026-07-01T00:00:00.000Z' : null,
          updated_at: updatedAt,
        },
      },
    })

    const expired = await postSignedWebhook(
      lemonSqueezyWebhook,
      'https://tryarty.com/api/webhook/lemonsqueezy',
      'X-Signature',
      LEMON_SQUEEZY_SECRET,
      event('subscription_expired', 'expired', '2026-07-09T11:00:00.000Z'),
    )
    expect(expired.status).toBe(200)

    const staleActive = await postSignedWebhook(
      lemonSqueezyWebhook,
      'https://tryarty.com/api/webhook/lemonsqueezy',
      'X-Signature',
      LEMON_SQUEEZY_SECRET,
      event('subscription_updated', 'active', '2026-07-08T11:00:00.000Z'),
    )
    expect(staleActive.status).toBe(200)

    const row = await h.db.prepare(
      `SELECT plan_type, status, provider_updated_at
       FROM subscriptions WHERE user_email = ?1`,
    ).bind(email).first<{
      plan_type: string
      status: string
      provider_updated_at: string
    }>()
    expect(row).toEqual({
      plan_type: 'inactive',
      status: 'expired',
      provider_updated_at: '2026-07-09T11:00:00.000Z',
    })
  })

  it('protège aussi une ligne historique sans horodatage fournisseur', async () => {
    const email = 'legacy-expired@example.com'
    await h.db.prepare(
      `INSERT INTO subscriptions
        (user_email, status, plan_type, provider_updated_at, updated_at)
       VALUES (?1, 'expired', 'inactive', NULL, '2026-07-09 12:00:00')`,
    ).bind(email).run()

    const staleActive = await postSignedWebhook(
      lemonSqueezyWebhook,
      'https://tryarty.com/api/webhook/lemonsqueezy',
      'X-Signature',
      LEMON_SQUEEZY_SECRET,
      {
        meta: { event_name: 'subscription_updated' },
        data: {
          id: 'sub_legacy_1',
          type: 'subscriptions',
          attributes: {
            user_email: email,
            status: 'active',
            renews_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-07-08T12:00:00.000Z',
          },
        },
      },
    )
    expect(staleActive.status).toBe(200)

    expect(await h.db.prepare(
      `SELECT plan_type, status, provider_updated_at
       FROM subscriptions WHERE user_email = ?1`,
    ).bind(email).first()).toEqual({
      plan_type: 'inactive',
      status: 'expired',
      provider_updated_at: '2026-07-09T12:00:00.000Z',
    })
  })
})
