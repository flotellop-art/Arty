import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as deleteAccount } from '../../../functions/api/account/delete'

type RunResult = { success: boolean; meta?: { changes?: number } }

class AccountDeleteDbMock {
  tables = new Map<string, Map<string, number>>()
  missingTables = new Set<string>()

  constructor(tableNames: string[]) {
    for (const table of tableNames) this.tables.set(table, new Map())
  }

  seed(table: string, email: string, count = 1) {
    if (!this.tables.has(table)) this.tables.set(table, new Map())
    this.tables.get(table)!.set(email, count)
  }

  count(table: string, email: string): number {
    return this.tables.get(table)?.get(email) ?? 0
  }

  prepare(sql: string) {
    const db = this
    const match = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \?1$/)
    return {
      bind(email: unknown) {
        return {
          async run(): Promise<RunResult> {
            if (!match) return { success: true, meta: { changes: 0 } }
            const table = match[1]
            if (db.missingTables.has(table)) throw new Error(`no such table: ${table}`)
            const rows = db.tables.get(table)
            const key = String(email)
            const changes = rows?.get(key) ?? 0
            rows?.delete(key)
            return { success: true, meta: { changes } }
          },
        }
      },
    }
  }
}

const TABLES = [
  'memory',
  'quota',
  'quota_model',
  'free_daily_quota',
  'trial_usage',
  'premium_cap',
  'subscriptions',
  'licenses',
  'premium_packs',
]

function request(body: unknown = {}, token = 'google-token') {
  return new Request('https://tryarty.com/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-google-token': token },
    body: JSON.stringify(body),
  })
}

describe('/api/account/delete privacy deletion', () => {
  let db: AccountDeleteDbMock

  beforeEach(() => {
    db = new AccountDeleteDbMock(TABLES)
    vi.restoreAllMocks()
  })

  it('deletes all known server-side rows for the verified Google email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ email: 'owner@example.com' })))
    for (const table of TABLES) {
      db.seed(table, 'owner@example.com', 2)
      db.seed(table, 'other@example.com', 1)
    }

    const res = await deleteAccount({ request: request(), env: { DB: db } } as any)
    const json = await res.json() as { success?: boolean; email?: string; deleted?: Record<string, number> }

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.email).toBe('owner@example.com')
    for (const table of TABLES) {
      expect(json.deleted?.[table]).toBe(2)
      expect(db.count(table, 'owner@example.com')).toBe(0)
      expect(db.count(table, 'other@example.com')).toBe(1)
    }
  })

  it('ignores spoofed body email and only deletes the verified token owner', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ email: 'attacker@example.com' })))
    db.seed('subscriptions', 'victim@example.com', 1)
    db.seed('subscriptions', 'attacker@example.com', 1)
    db.seed('memory', 'victim@example.com', 1)
    db.seed('memory', 'attacker@example.com', 1)

    const res = await deleteAccount({
      request: request({ email: 'victim@example.com', user_id: 'victim@example.com' }),
      env: { DB: db },
    } as any)
    const json = await res.json() as { email?: string; deleted?: Record<string, number> }

    expect(res.status).toBe(200)
    expect(json.email).toBe('attacker@example.com')
    expect(db.count('subscriptions', 'victim@example.com')).toBe(1)
    expect(db.count('memory', 'victim@example.com')).toBe(1)
    expect(db.count('subscriptions', 'attacker@example.com')).toBe(0)
    expect(db.count('memory', 'attacker@example.com')).toBe(0)
  })

  it('rejects invalid Google tokens without deleting anything', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad token', { status: 401 })))
    db.seed('subscriptions', 'owner@example.com', 1)

    const res = await deleteAccount({ request: request(), env: { DB: db } } as any)

    expect(res.status).toBe(404)
    expect(db.count('subscriptions', 'owner@example.com')).toBe(1)
  })

  it('skips lazily-created tables that do not exist yet without aborting deletion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ email: 'owner@example.com' })))
    db.seed('memory', 'owner@example.com', 1)
    db.seed('subscriptions', 'owner@example.com', 1)
    db.missingTables.add('quota_model')

    const res = await deleteAccount({ request: request(), env: { DB: db } } as any)
    const json = await res.json() as { skipped?: string[] }

    expect(res.status).toBe(200)
    expect(json.skipped).toContain('quota_model')
    expect(db.count('memory', 'owner@example.com')).toBe(0)
    expect(db.count('subscriptions', 'owner@example.com')).toBe(0)
  })
})
