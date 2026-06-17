// OAuth audit — vérification SQL empirique des schémas D1 (node:sqlite).
// Exécute le SQL EXACT des fonctions serveur contre un SQLite en mémoire pour
// trancher : trial/init created_at, downgrade license/activate, cap free.
// Lancer : node scripts/oauth-audit-sql-checks.mjs
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'

// Schéma EXACT de functions/api/webhook/lemonsqueezy.ts:112-121 (ensureSubscriptionsTable)
const SUBSCRIPTIONS_SCHEMA = `CREATE TABLE IF NOT EXISTS subscriptions (
  user_email TEXT PRIMARY KEY,
  plan_type TEXT NOT NULL,
  status TEXT NOT NULL,
  ls_subscription_id TEXT,
  ls_customer_id TEXT,
  ls_variant_id TEXT,
  current_period_end TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`

let pass = 0
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++ }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); process.exitCode = 1 }
}

console.log('\n[1] trial/init INSERT (created_at) vs runtime subscriptions schema')
check('throws "no column named created_at" → new trial 503 if this schema is live', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(SUBSCRIPTIONS_SCHEMA)
  // SQL de functions/api/trial/init.ts:157
  const sql = `INSERT INTO subscriptions (user_email, status, plan_type, created_at, updated_at)
     VALUES ('newuser@x.z', 'active', 'trial', datetime('now'), datetime('now'))`
  let threw = null
  try { db.prepare(sql).run() } catch (e) { threw = e }
  assert.ok(threw, 'expected the INSERT to throw')
  assert.match(threw.message, /no column named created_at/i)
  db.close()
})

console.log('\n[2] license/activate upsert vs an active monthly subscriber')
check('downgrades plan_type→pro BUT preserves current_period_end + ls_subscription_id', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(SUBSCRIPTIONS_SCHEMA)
  db.prepare(
    `INSERT INTO subscriptions (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
     VALUES ('victim@x.z','subscription','active','sub_123','cus_1','var_1','2099-01-01', unixepoch())`
  ).run()
  // Upsert EXACT de functions/api/license/activate.ts:124-131
  db.prepare(
    `INSERT INTO subscriptions
      (user_email, plan_type, status, ls_subscription_id, ls_customer_id,
       ls_variant_id, current_period_end, updated_at)
     VALUES ('victim@x.z', 'pro', 'active', NULL, NULL, NULL, NULL, unixepoch())
     ON CONFLICT(user_email) DO UPDATE SET
       plan_type = 'pro',
       status = 'active',
       updated_at = unixepoch()`
  ).run()
  const row = db.prepare(`SELECT * FROM subscriptions WHERE user_email='victim@x.z'`).get()
  assert.equal(row.plan_type, 'pro', 'DOWNGRADE: subscription → pro')
  assert.equal(row.current_period_end, '2099-01-01', 'period preserved (not in SET)')
  assert.equal(row.ls_subscription_id, 'sub_123', 'sub id preserved → auto-repairable')
  db.close()
})

console.log('\n[3] free_daily_quota atomic upsert cap (N-1 abuse bound)')
check('caps at exactly 10, no overflow (11th call returns no row)', () => {
  const db = new DatabaseSync(':memory:')
  // Schéma EXACT de functions/api/_lib/freeQuota.ts:48-55
  db.exec(`CREATE TABLE IF NOT EXISTS free_daily_quota (
    email TEXT NOT NULL, day TEXT NOT NULL, family TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    PRIMARY KEY (email, day, family)
  )`)
  // Upsert EXACT de freeQuota.ts:90-96 (?4 = limit = 10)
  const upsert = db.prepare(
    `INSERT INTO free_daily_quota (email, day, family, count, updated_at)
     VALUES ('u@x.z','2026-06-15','claude-haiku', 1, unixepoch())
     ON CONFLICT (email, day, family) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       WHERE free_daily_quota.count < 10
     RETURNING count`
  )
  const counts = []
  for (let i = 0; i < 12; i++) { const r = upsert.get(); counts.push(r ? r.count : undefined) }
  assert.deepEqual(counts.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(counts[10], undefined, '11th call blocked by WHERE count<10')
  assert.equal(counts[11], undefined, 'hard cap at 10')
  db.close()
})

console.log(`\n${pass}/3 SQL checks passed${process.exitCode ? ' — SOME FAILED' : ''}\n`)
