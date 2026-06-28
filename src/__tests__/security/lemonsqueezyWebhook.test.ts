import { describe, expect, it } from 'vitest'
import { onRequestPost as lemonWebhook } from '../../../functions/api/webhook/lemonsqueezy'

type RunResult = { success: boolean; meta?: { changes?: number } }

class LemonDbMock {
  premiumPacks = new Map<string, { user_email: string; order_id: string; messages_total: number; messages_used: number }>()
  licenses = new Map<string, { user_email: string; order_id: string; license_key: string; activations: number; max_activations: number; status: string }>()
  subscriptions = new Map<string, { plan_type: string; status: string; current_period_end?: string | null }>()

  prepare(sql: string) {
    const db = this
    const execute = async (args: unknown[]): Promise<RunResult> => {
      if (sql.includes('CREATE TABLE')) return { success: true }

      if (sql.includes('INSERT INTO premium_packs')) {
        const [email, orderId, total] = args as [string, string, number]
        const key = `${email}:${orderId}`
        const existing = db.premiumPacks.get(key)
        if (!existing) {
          db.premiumPacks.set(key, { user_email: email, order_id: orderId, messages_total: total, messages_used: 0 })
        } else {
          existing.messages_total = Math.max(existing.messages_total, total)
          // Important: messages_used is intentionally preserved on replay.
        }
        return { success: true, meta: { changes: 1 } }
      }

      if (sql.includes('INSERT INTO licenses')) {
        const [email, orderId, licenseKey, maxActivations] = args as [string, string, string, number]
        const key = `${email}:${orderId}`
        const existing = db.licenses.get(key)
        if (!existing) {
          db.licenses.set(key, { user_email: email, order_id: orderId, license_key: licenseKey, max_activations: maxActivations, activations: 0, status: 'active' })
        } else {
          if (!existing.license_key && licenseKey) existing.license_key = licenseKey
          existing.max_activations = Math.max(existing.max_activations, maxActivations)
          existing.status = 'active'
          // Important: activations is intentionally preserved on replay.
        }
        return { success: true, meta: { changes: 1 } }
      }

      if (sql.includes('INSERT INTO subscriptions')) {
        const email = args[0] as string
        const existing = db.subscriptions.get(email)
        const requestedPlan = sql.includes("VALUES (?1, 'pro'") ? 'pro' : (args[1] as string)
        const requestedStatus = sql.includes("VALUES (?1, 'pro'") ? 'active' : (args[2] as string)
        if (existing?.plan_type === 'pro' || existing?.plan_type === 'vip') {
          db.subscriptions.set(email, { ...existing, status: 'active' })
        } else {
          db.subscriptions.set(email, { plan_type: requestedPlan, status: requestedStatus, current_period_end: (args[6] as string | null | undefined) ?? null })
        }
        return { success: true, meta: { changes: 1 } }
      }

      if (sql.includes('UPDATE subscriptions')) {
        const [newStatus, email] = args as [string, string]
        const existing = db.subscriptions.get(email)
        if (existing) {
          db.subscriptions.set(email, {
            ...existing,
            status: existing.plan_type === 'pro' || existing.plan_type === 'vip' ? 'active' : newStatus,
          })
        }
        return { success: true, meta: { changes: existing ? 1 : 0 } }
      }

      return { success: true }
    }

    return {
      run: () => execute([]),
      bind(...args: unknown[]) {
        return { run: () => execute(args) }
      },
    }
  }
}

async function hmacHex(raw: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function signedRequest(payload: unknown, secret = 'test-webhook-secret') {
  const raw = JSON.stringify(payload)
  return new Request('https://tryarty.com/api/webhook/lemonsqueezy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': await hmacHex(raw, secret) },
    body: raw,
  })
}

function env(db: LemonDbMock) {
  return { DB: db, LEMONSQUEEZY_WEBHOOK_SECRET: 'test-webhook-secret' }
}

describe('Lemon Squeezy webhook idempotence', () => {
  it('does not reset premium pack usage on signed order_created replay', async () => {
    const db = new LemonDbMock()
    const payload = {
      meta: { event_name: 'order_created' },
      data: { id: 'order-pack-1', attributes: { user_email: 'user@example.com', first_order_item: { product_id: 1004493 } } },
    }

    expect((await lemonWebhook({ request: await signedRequest(payload), env: env(db) } as any)).status).toBe(200)
    db.premiumPacks.get('user@example.com:order-pack-1')!.messages_used = 37
    expect((await lemonWebhook({ request: await signedRequest(payload), env: env(db) } as any)).status).toBe(200)

    expect(db.premiumPacks.get('user@example.com:order-pack-1')).toMatchObject({ messages_total: 100, messages_used: 37 })
  })

  it('does not reset license activations on signed Pro order replay', async () => {
    const db = new LemonDbMock()
    const payload = {
      meta: { event_name: 'order_created' },
      data: { id: 'order-pro-1', attributes: { user_email: 'user@example.com', first_order_item: { product_id: 1004485 } } },
      included: [{ type: 'license-keys', attributes: { key: 'LIC-ORDER-PRO' } }],
    }

    await lemonWebhook({ request: await signedRequest(payload), env: env(db) } as any)
    db.licenses.get('user@example.com:order-pro-1')!.activations = 2
    await lemonWebhook({ request: await signedRequest(payload), env: env(db) } as any)

    expect(db.licenses.get('user@example.com:order-pro-1')).toMatchObject({ license_key: 'LIC-ORDER-PRO', activations: 2, status: 'active' })
  })

  it('does not downgrade lifetime Pro entitlement on later subscription status events', async () => {
    const db = new LemonDbMock()
    db.subscriptions.set('user@example.com', { plan_type: 'pro', status: 'active' })

    const payload = {
      meta: { event_name: 'subscription_expired' },
      data: { id: 'sub-1', attributes: { user_email: 'user@example.com', status: 'expired' } },
    }

    await lemonWebhook({ request: await signedRequest(payload), env: env(db) } as any)

    expect(db.subscriptions.get('user@example.com')).toEqual({ plan_type: 'pro', status: 'active' })
  })
})
