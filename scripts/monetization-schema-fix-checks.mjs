// Vérification empirique de la réconciliation schéma↔code monétisation
// (15 juin 2026). Recrée le schéma RÉEL de prod (migration 0002 + l'index
// unique de 0005) dans un SQLite en mémoire, puis exécute le SQL CORRIGÉ des
// 3 chemins d'achat et prouve qu'ils fonctionnent enfin.
// Lancer : node scripts/monetization-schema-fix-checks.mjs
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'

let pass = 0
let total = 0
function check(name, fn) {
  total++
  try { fn(); console.log(`  ✅ ${name}`); pass++ }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); process.exitCode = 1 }
}

// Schéma EXACT de prod (migration 0002) + index unique de 0005.
function freshDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      ls_subscription_id TEXT UNIQUE,
      ls_customer_id TEXT, ls_variant_id TEXT,
      status TEXT NOT NULL DEFAULT 'inactive',
      plan_type TEXT NOT NULL DEFAULT 'free',
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_subscriptions_user_email_unique ON subscriptions(user_email);
    CREATE TABLE licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      license_key TEXT UNIQUE NOT NULL,
      ls_order_id TEXT UNIQUE,
      ls_product_id TEXT,
      activation_count INTEGER NOT NULL DEFAULT 0,
      max_activations INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE premium_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      ls_order_id TEXT UNIQUE NOT NULL,
      messages_total INTEGER NOT NULL DEFAULT 100,
      messages_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`)
  return db
}

console.log('\n[1] Achat licence Pro (webhook order_created) → enregistrement licence + subscription')
check('licences: INSERT OR REPLACE avec ls_order_id/activation_count fonctionne', () => {
  const db = freshDb()
  db.prepare(
    `INSERT OR REPLACE INTO licenses (user_email, ls_order_id, license_key, status, max_activations, activation_count, created_at)
     VALUES ('buyer@x.z', 'ord_1', 'KEY-ABC123', 'active', 3, 0, datetime('now'))`
  ).run()
  const row = db.prepare(`SELECT * FROM licenses WHERE user_email='buyer@x.z'`).get()
  assert.equal(row.ls_order_id, 'ord_1')
  assert.equal(row.activation_count, 0)
  db.close()
})

check('subscription upsert ON CONFLICT(user_email) fonctionne (n’échoue plus)', () => {
  const db = freshDb()
  const stmt = () => db.prepare(
    `INSERT INTO subscriptions (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
     VALUES ('buyer@x.z', 'pro', 'active', NULL, NULL, NULL, NULL, datetime('now'))
     ON CONFLICT(user_email) DO UPDATE SET plan_type='pro', status='active', updated_at=datetime('now')
     WHERE subscriptions.plan_type NOT IN ('subscription','vip')`
  ).run()
  stmt(); stmt() // idempotent — 2 appels, pas d'erreur, 1 seule ligne
  const rows = db.prepare(`SELECT COUNT(*) c FROM subscriptions WHERE user_email='buyer@x.z'`).get()
  assert.equal(rows.c, 1)
  assert.equal(db.prepare(`SELECT plan_type FROM subscriptions WHERE user_email='buyer@x.z'`).get().plan_type, 'pro')
  db.close()
})

console.log('\n[2] Activation de licence (activate.ts)')
check('SELECT ls_order_id/activation_count + UPDATE activation_count incrémente', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO licenses (user_email, ls_order_id, license_key, status, max_activations, activation_count) VALUES ('u@x.z','ord_9','K-9','active',3,0)`).run()
  const lic = db.prepare(`SELECT ls_order_id, status, max_activations, activation_count FROM licenses WHERE license_key='K-9' AND user_email='u@x.z' LIMIT 1`).get()
  assert.equal(lic.activation_count, 0)
  const upd = db.prepare(
    `UPDATE licenses SET activation_count = activation_count + 1
     WHERE license_key='K-9' AND user_email='u@x.z' AND ls_order_id=? AND status='active' AND activation_count < max_activations`
  ).run(lic.ls_order_id)
  assert.equal(upd.changes, 1)
  assert.equal(db.prepare(`SELECT activation_count FROM licenses WHERE license_key='K-9'`).get().activation_count, 1)
  db.close()
})

console.log('\n[3] Garde anti-downgrade : un abonné mensuel actif n’est PAS rétrogradé en pro')
check('activate upsert préserve un subscription/active (WHERE plan_type NOT IN ...)', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO subscriptions (user_email, plan_type, status, ls_subscription_id, current_period_end) VALUES ('sub@x.z','subscription','active','sub_7','2099-01-01')`).run()
  db.prepare(
    `INSERT INTO subscriptions (user_email, plan_type, status, ls_subscription_id, ls_customer_id, ls_variant_id, current_period_end, updated_at)
     VALUES ('sub@x.z','pro','active',NULL,NULL,NULL,NULL,datetime('now'))
     ON CONFLICT(user_email) DO UPDATE SET plan_type='pro', status='active', updated_at=datetime('now')
     WHERE subscriptions.plan_type NOT IN ('subscription','vip')`
  ).run()
  const row = db.prepare(`SELECT plan_type, ls_subscription_id FROM subscriptions WHERE user_email='sub@x.z'`).get()
  assert.equal(row.plan_type, 'subscription', 'abonné mensuel préservé')
  assert.equal(row.ls_subscription_id, 'sub_7', 'lien abo préservé')
  db.close()
})

console.log('\n[4] Pack de messages (premium_packs)')
check('INSERT OR REPLACE + consommation FIFO avec ls_order_id', () => {
  const db = freshDb()
  db.prepare(`INSERT OR REPLACE INTO premium_packs (user_email, ls_order_id, messages_total, messages_used, created_at) VALUES ('p@x.z','ord_p1',100,0,datetime('now'))`).run()
  const bal = db.prepare(`SELECT COALESCE(SUM(messages_total - messages_used),0) r FROM premium_packs WHERE user_email='p@x.z' AND messages_used < messages_total`).get()
  assert.equal(bal.r, 100)
  const oldest = db.prepare(`SELECT user_email, ls_order_id FROM premium_packs WHERE user_email='p@x.z' AND messages_used < messages_total ORDER BY created_at ASC, ls_order_id ASC LIMIT 1`).get()
  const res = db.prepare(`UPDATE premium_packs SET messages_used = messages_used + 1 WHERE user_email=? AND ls_order_id=? AND messages_used < messages_total`).run(oldest.user_email, oldest.ls_order_id)
  assert.equal(res.changes, 1)
  db.close()
})

console.log('\n[5] Essai gratuit : ON CONFLICT DO NOTHING ne lève jamais, déduplique')
check('trial/init INSERT ... ON CONFLICT DO NOTHING ne crée pas de doublon', () => {
  const db = freshDb()
  const ins = () => db.prepare(
    `INSERT INTO subscriptions (user_email, status, plan_type, created_at, updated_at)
     VALUES ('t@x.z','active','trial',datetime('now'),datetime('now')) ON CONFLICT DO NOTHING`
  ).run()
  ins(); ins() // 2 appels — aucun throw, 1 seule ligne
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM subscriptions WHERE user_email='t@x.z'`).get().c, 1)
  db.close()
})

console.log('\n[6] Détection Pro via licenses (resolveUserPlan) sans expires_at')
check('SELECT 1 FROM licenses WHERE status=’active’ trouve la licence (plus de plantage expires_at)', () => {
  const db = freshDb()
  db.prepare(`INSERT INTO licenses (user_email, ls_order_id, license_key, status, max_activations, activation_count) VALUES ('pro@x.z','ord_x','K-X','active',3,1)`).run()
  const lic = db.prepare(`SELECT 1 AS ok FROM licenses WHERE user_email='pro@x.z' AND status='active' LIMIT 1`).get()
  assert.equal(lic?.ok, 1)
  db.close()
})

console.log(`\n${pass}/${total} checks passed${process.exitCode ? ' — SOME FAILED' : ''}\n`)
