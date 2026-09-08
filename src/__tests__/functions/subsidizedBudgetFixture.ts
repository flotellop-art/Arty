import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../../../migrations/0013_subsidized_budget.sql', import.meta.url), 'utf8')
  .split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(';').filter(sql => sql.trim())

/** Explicit, synthetic funding for positive local-D1 tests only. Never a production default. */
export async function fundSyntheticSubsidizedBudget(db: D1Database) {
  for (const sql of schema) await db.prepare(sql).run()
  await db.prepare('DELETE FROM subsidized_attempt_v1').run()
  await db.prepare('DELETE FROM subsidized_budget_v1').run()
  await db.prepare("INSERT INTO subsidized_budget_v1 (scope,revision,enabled,limit_micro_usd,limit_attempts) VALUES ('arty-subsidized',1,1,50000000,10)").run()
}
