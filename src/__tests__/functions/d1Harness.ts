// Harnais de tests d'intégration D1 (C8/F-5) : instancie un D1 RÉEL en mémoire
// via Miniflare (workerd) et applique le schéma de prod (`schema.sql`). Les
// endpoints s'auto-réparent (CREATE TABLE IF NOT EXISTS au runtime, BUG 38) :
// on laisse donc les `ensureXxx` des modules compléter les index manquants
// (ex. l'index partiel unique du ledger, absent de schema.sql).
//
// NB : ces fichiers tournent en environnement `node` (docblock @vitest-environment
// node en tête de chaque test) — pas jsdom — car Miniflare lance un sous-process
// workerd.
import { readFileSync } from 'node:fs'
import { Miniflare } from 'miniflare'
import type { Env } from '../../../functions/env'

export interface D1Harness {
  env: Env
  db: D1Database
  reset: () => Promise<void>
  dispose: () => Promise<void>
}

function loadSchemaStatements(): string[] {
  const raw = readFileSync(new URL('../../../schema.sql', import.meta.url), 'utf-8')
  return raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('--')) // retire les commentaires pleine ligne
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function makeD1Harness(extraEnv: Partial<Env> = {}): Promise<D1Harness> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: ':memory:' },
  })
  const db = (await mf.getD1Database('DB')) as unknown as D1Database
  for (const stmt of loadSchemaStatements()) {
    await db.prepare(stmt).run()
  }
  const env = { DB: db, ...extraEnv } as unknown as Env
  return {
    env,
    db,
    async reset() {
      // Purge les lignes entre tests. D1 interdit l'accès à sqlite_master
      // (SQLITE_AUTH) → liste fixe des tables de schema.sql.
      const tables = [
        'memory', 'quota', 'quota_model', 'free_daily_quota', 'premium_cap',
        'bg_quota', 'checkout_quota', 'trial_usage', 'email_otp',
        'email_trial_sessions', 'email_trial_usage', 'otp_rate', 'subscriptions',
        'licenses', 'premium_packs', 'wallet', 'credit_ledger', 'reservation',
        'webhook_event', 'shared_conversations',
      ]
      for (const t of tables) {
        try { await db.prepare(`DELETE FROM ${t}`).run() } catch { /* table absente */ }
      }
    },
    async dispose() {
      await mf.dispose()
    },
  }
}
