// Vérifie que la capture de la clé de licence (événement license_key_created)
// fonctionne contre le schéma réel de prod (licenses : ls_order_id UNIQUE,
// license_key UNIQUE NOT NULL). Avant le fix, order_created stockait
// license_key='' → activation impossible.
// Lancer : node scripts/license-key-capture-checks.mjs
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'

let pass = 0, total = 0
function check(name, fn) {
  total++
  try { fn(); console.log(`  ✅ ${name}`); pass++ }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); process.exitCode = 1 }
}

function freshDb() {
  const db = new DatabaseSync(':memory:')
  // Schéma EXACT de prod (migration 0002).
  db.exec(`CREATE TABLE licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    license_key TEXT UNIQUE NOT NULL,
    ls_order_id TEXT UNIQUE,
    ls_product_id TEXT,
    activation_count INTEGER NOT NULL DEFAULT 0,
    max_activations INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  return db
}

// SQL EXACT de handleLicenseKeyCreated (lemonsqueezy.ts), ?N → littéraux.
function licenseKeyCreated(db, { email, orderId, key, maxAct = 3 }) {
  db.prepare(
    `INSERT INTO licenses
      (user_email, ls_order_id, license_key, status, max_activations, activation_count, created_at)
     VALUES ('${email}', '${orderId}', '${key}', 'active', ${maxAct}, 0, datetime('now'))
     ON CONFLICT(ls_order_id) DO UPDATE SET
       license_key = excluded.license_key,
       user_email = excluded.user_email,
       max_activations = excluded.max_activations,
       status = 'active'`
  ).run()
}

console.log('\n[1] license_key_created stocke la VRAIE clé (plus de placeholder vide)')
check('la clé réelle est enregistrée et retrouvable par license/activate', () => {
  const db = freshDb()
  licenseKeyCreated(db, { email: 'buyer@x.z', orderId: '8701856', key: 'CFBDC031-C88D-4980-95F9-74F6E42270D9' })
  // La requête de activate.ts : WHERE license_key=?1 AND user_email=?2
  const row = db.prepare(
    `SELECT ls_order_id, status, max_activations, activation_count
       FROM licenses WHERE license_key='CFBDC031-C88D-4980-95F9-74F6E42270D9' AND user_email='buyer@x.z' LIMIT 1`
  ).get()
  assert.ok(row, 'la licence doit être trouvée par sa clé')
  assert.equal(row.ls_order_id, '8701856')
  assert.equal(row.activation_count, 0)
  assert.equal(row.max_activations, 3)
  db.close()
})

console.log('\n[2] idempotent : 2 livraisons du même événement → 1 ligne, clé conservée')
check('ON CONFLICT(ls_order_id) ne crée pas de doublon et garde la clé', () => {
  const db = freshDb()
  licenseKeyCreated(db, { email: 'buyer@x.z', orderId: '8701856', key: 'KEY-REAL-1' })
  licenseKeyCreated(db, { email: 'buyer@x.z', orderId: '8701856', key: 'KEY-REAL-1' })
  const n = db.prepare(`SELECT COUNT(*) c FROM licenses WHERE ls_order_id='8701856'`).get()
  assert.equal(n.c, 1)
  assert.equal(db.prepare(`SELECT license_key k FROM licenses WHERE ls_order_id='8701856'`).get().k, 'KEY-REAL-1')
  db.close()
})

console.log('\n[3] respecte activation_limit de Lemon Squeezy')
check('max_activations vient de activation_limit', () => {
  const db = freshDb()
  licenseKeyCreated(db, { email: 'buyer@x.z', orderId: 'ord_5', key: 'KEY-5', maxAct: 5 })
  assert.equal(db.prepare(`SELECT max_activations m FROM licenses WHERE ls_order_id='ord_5'`).get().m, 5)
  db.close()
})

console.log('\n[4] pas de placeholder vide (régression du bug du 15 juin)')
check('aucune licence avec license_key vide', () => {
  const db = freshDb()
  licenseKeyCreated(db, { email: 'buyer@x.z', orderId: 'ord_6', key: 'KEY-6' })
  const empties = db.prepare(`SELECT COUNT(*) c FROM licenses WHERE license_key=''`).get()
  assert.equal(empties.c, 0)
  db.close()
})

console.log(`\n${pass}/${total} checks passed${process.exitCode ? ' — SOME FAILED' : ''}\n`)
