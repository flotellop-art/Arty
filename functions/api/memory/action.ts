import type { Env } from '../../env'

async function ensureTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS memory (
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, category)
    )
  `).run()
}

let tableReady = false

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  // Auto-create table on first call
  if (!tableReady) {
    await ensureTable(env.DB)
    tableReady = true
  }

  const body = await request.json() as Record<string, unknown>
  const type = body.type as string
  const userId = body.userId as string

  if (!userId) {
    return Response.json({ error: 'Missing userId' }, { status: 400 })
  }

  try {
    switch (type) {
      case 'read': {
        const category = body.category as string
        if (!category) return Response.json({ error: 'Missing category' }, { status: 400 })

        const result = await env.DB.prepare(
          'SELECT data FROM memory WHERE user_id = ? AND category = ?'
        ).bind(userId, category).first<{ data: string }>()

        if (!result) return Response.json({ data: null })
        return Response.json({ data: JSON.parse(result.data) })
      }

      case 'write': {
        const category = body.category as string
        const data = body.data

        if (!category || data === undefined) {
          return Response.json({ error: 'Missing category or data' }, { status: 400 })
        }

        await env.DB.prepare(
          `INSERT INTO memory (user_id, category, data, updated_at)
           VALUES (?, ?, ?, unixepoch())
           ON CONFLICT(user_id, category)
           DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
        ).bind(userId, category, JSON.stringify(data)).run()

        return Response.json({ success: true })
      }

      case 'readAll': {
        const results = await env.DB.prepare(
          'SELECT category, data FROM memory WHERE user_id = ?'
        ).bind(userId).all<{ category: string; data: string }>()

        const memory: Record<string, unknown> = {}
        for (const row of results.results || []) {
          memory[row.category] = JSON.parse(row.data)
        }
        return Response.json({ data: memory })
      }

      case 'delete': {
        const category = body.category as string
        if (!category) return Response.json({ error: 'Missing category' }, { status: 400 })

        await env.DB.prepare(
          'DELETE FROM memory WHERE user_id = ? AND category = ?'
        ).bind(userId, category).run()

        return Response.json({ success: true })
      }

      default:
        return Response.json({ error: 'Use type: read, write, readAll, delete' }, { status: 400 })
    }
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Database error' },
      { status: 500 }
    )
  }
}
