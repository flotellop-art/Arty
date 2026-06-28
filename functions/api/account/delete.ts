import type { Env } from '../../env'
import { notFoundResponse, verifyGoogleUser } from '../_lib/checkAllowedUser'

type DeleteSpec = {
  table: string
  column: string
}

const DELETE_SPECS: DeleteSpec[] = [
  { table: 'memory', column: 'user_id' },
  { table: 'quota', column: 'email' },
  { table: 'quota_model', column: 'email' },
  { table: 'free_daily_quota', column: 'email' },
  { table: 'trial_usage', column: 'email' },
  { table: 'premium_cap', column: 'email' },
  { table: 'subscriptions', column: 'user_email' },
  { table: 'licenses', column: 'user_email' },
  { table: 'premium_packs', column: 'user_email' },
]

type DeleteResult = {
  deleted: Record<string, number>
  skipped: string[]
}

function changesFromRun(result: { meta?: { changes?: number } }): number {
  return Math.max(0, Number(result.meta?.changes ?? 0) || 0)
}

async function deleteAccountRows(db: D1Database, email: string): Promise<DeleteResult> {
  const deleted: Record<string, number> = {}
  const skipped: string[] = []

  for (const spec of DELETE_SPECS) {
    try {
      const result = await db.prepare(
        `DELETE FROM ${spec.table} WHERE ${spec.column} = ?1`
      ).bind(email).run()
      deleted[spec.table] = changesFromRun(result)
    } catch (err) {
      // D1 deployments may lag migrations (several tables are created lazily by
      // webhook/quota handlers). A missing optional table must not prevent the
      // user from deleting data that does exist elsewhere.
      console.warn(`[account/delete] skipped ${spec.table}`, err)
      skipped.push(spec.table)
    }
  }

  return { deleted, skipped }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await verifyGoogleUser(request)
  if (!email) return notFoundResponse()

  if (!env.DB) {
    return Response.json({ success: true, email, deleted: {}, skipped: ['DB'] })
  }

  const result = await deleteAccountRows(env.DB, email)
  return Response.json({ success: true, email, ...result })
}
