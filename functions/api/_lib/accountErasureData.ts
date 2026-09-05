import { emailTrialKey } from './emailTrial'

/** Exact existing erasure scope, shared by old APKs and the receipt protocol.
 * Quota, usage and billing are deliberately NOT erased. Table/column names
 * are constants; only identities and a server-owned SQL gate are bound. */
export async function accountErasureStatements(db: D1Database, email: string, kind: 'google' | 'email-trial',
  gate?: { sql: string; values: string[] }): Promise<D1PreparedStatement[]> {
  const existing = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
    'memory', 'shared_conversations', 'content_reports', 'email_otp', 'email_trial_sessions', 'acquisition'
  )`).all<{ name: string }>()
  if (!existing.success) throw new Error('Erasure inventory unavailable')
  const present = new Set(existing.results.map(row => row.name)), statements: D1PreparedStatement[] = []
  const add = (table: string, column: string, identity: string) => {
    if (present.has(table)) statements.push(db.prepare(`DELETE FROM ${table} WHERE ${column} = ?1${gate ? ` AND (${gate.sql})` : ''}`)
      .bind(identity, ...(gate?.values ?? [])))
  }
  add('email_otp', 'email', email)
  add('email_trial_sessions', 'email', email)
  add('acquisition', 'email', email)
  const trial = emailTrialKey(email)
  add('memory', 'user_id', trial)
  add('shared_conversations', 'owner_email', trial)
  add('content_reports', 'reporter_email', trial)
  add('content_reports', 'reporter_email', `emailtrial:${email}`)
  if (kind === 'google') {
    add('memory', 'user_id', email)
    add('shared_conversations', 'owner_email', email)
    add('content_reports', 'reporter_email', email)
  }
  return statements
}
