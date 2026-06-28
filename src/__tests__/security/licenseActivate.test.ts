import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as activateLicense } from '../../../functions/api/license/activate'

type LicenseRow = { order_id: string; status: string; max_activations: number; activations: number; user_email: string; license_key: string }

type RunResult = { success: boolean; meta?: { changes?: number } }

class LicenseDbMock {
  licenses = new Map<string, LicenseRow>()
  subscriptions = new Map<string, { plan_type: string; status: string }>()

  prepare(sql: string) {
    const db = this
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>() {
            if (sql.includes('FROM licenses') && sql.includes('WHERE license_key')) {
              const [licenseKey, email] = args as [string, string]
              const row = Array.from(db.licenses.values()).find(
                (l) => l.license_key === licenseKey && l.user_email === email
              )
              return (row ? { order_id: row.order_id, status: row.status, max_activations: row.max_activations, activations: row.activations } : null) as T | null
            }
            return null
          },
          async run(): Promise<RunResult> {
            if (sql.startsWith('UPDATE licenses')) {
              const [licenseKey, email, orderId] = args as [string, string, string]
              const row = db.licenses.get(`${email}:${orderId}`)
              if (!row || row.license_key !== licenseKey || row.status !== 'active' || row.activations >= row.max_activations) {
                return { success: true, meta: { changes: 0 } }
              }
              row.activations += 1
              return { success: true, meta: { changes: 1 } }
            }
            if (sql.includes('INSERT INTO subscriptions')) {
              const [email] = args as [string]
              const existing = db.subscriptions.get(email)
              db.subscriptions.set(email, {
                plan_type: existing?.plan_type === 'vip' ? 'vip' : 'pro',
                status: 'active',
              })
              return { success: true, meta: { changes: 1 } }
            }
            return { success: true, meta: { changes: 0 } }
          },
        }
      },
    }
  }
}

function request(body: unknown, token = 'google-token') {
  return new Request('https://tryarty.com/api/license/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-google-token': token },
    body: JSON.stringify(body),
  })
}

describe('/api/license/activate authentication binding', () => {
  let db: LicenseDbMock

  beforeEach(() => {
    db = new LicenseDbMock()
    db.licenses.set('victim@example.com:order-1', {
      user_email: 'victim@example.com',
      order_id: 'order-1',
      license_key: 'LIC-VALID-123',
      status: 'active',
      max_activations: 3,
      activations: 0,
    })
    vi.restoreAllMocks()
  })

  it('rejects body email spoofing even with a valid license key/email pair', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ email: 'attacker@example.com' })))

    const res = await activateLicense({
      request: request({
        license_key: 'LIC-VALID-123',
        email: 'victim@example.com',
        device_id: '123e4567-e89b-12d3-a456-426614174000',
      }),
      env: { DB: db },
    } as any)

    expect(res.status).toBe(404)
    expect(db.licenses.get('victim@example.com:order-1')?.activations).toBe(0)
    expect(db.subscriptions.has('victim@example.com')).toBe(false)
  })

  it('allows the normal owner flow and preserves higher vip entitlement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ email: 'victim@example.com' })))
    db.subscriptions.set('victim@example.com', { plan_type: 'vip', status: 'active' })

    const res = await activateLicense({
      request: request({
        license_key: 'LIC-VALID-123',
        email: 'victim@example.com',
        device_id: '123e4567-e89b-12d3-a456-426614174000',
      }),
      env: { DB: db },
    } as any)
    const json = await res.json() as { success?: boolean }

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(db.licenses.get('victim@example.com:order-1')?.activations).toBe(1)
    expect(db.subscriptions.get('victim@example.com')).toEqual({ plan_type: 'vip', status: 'active' })
  })
})
