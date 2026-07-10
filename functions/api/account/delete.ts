import type { Env } from '../../env'
import { verifyGoogleUserStrict } from '../_lib/checkAllowedUser'
import { emailTrialKey, verifyEmailTrialToken } from '../_lib/emailTrial'

/**
 * GDPR account erasure.
 *
 * Authentication is either an Arty-audience Google token or an email-trial
 * session token. Google identities may also erase trial records carrying the
 * same verified email; an email-trial identity remains isolated and can only
 * erase the dedicated `trial-email:` namespace (plus its historical report
 * alias `emailtrial:` during the retention transition).
 *
 * Billing records and minimal usage/anti-abuse counters are intentionally
 * retained. Keeping those counters prevents account deletion from resetting a
 * paid/trial/free quota while personal content, sessions and reports are erased.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  const hasGoogleCredential =
    request.headers.has('x-google-token') || request.headers.has('authorization')

  let email: string | null = null
  let kind: 'google' | 'email-trial' | null = null
  if (hasGoogleCredential) {
    email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
    if (email) kind = 'google'
  } else {
    email = await verifyEmailTrialToken(request, env)
    if (email) kind = 'email-trial'
  }

  if (!email || !kind) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const trialIdentity = emailTrialKey(email)
  // Rapports emis avant l'unification des identites email-trial. Conserver ce
  // namespace dans l'effacement tant que des lignes historiques peuvent vivre
  // pendant leur fenetre de retention.
  const legacyTrialReportIdentity = `emailtrial:${email}`

  try {
    // Plusieurs tables sont créées paresseusement par leur route. Une table
    // absente signifie « aucune donnée à effacer », pas une suppression en
    // échec. En revanche, toute erreur de découverte ou du batch reste un 500.
    const existing = await env.DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'memory', 'shared_conversations', 'content_reports',
         'email_otp', 'email_trial_sessions', 'email_trial_usage'
       )`
    ).all<{ name: string }>()
    const present = new Set((existing.results ?? []).map((row) => row.name))
    const statements: D1PreparedStatement[] = [
    ]

    const add = (table: string, sql: string, identity: string) => {
      if (present.has(table)) statements.push(env.DB.prepare(sql).bind(identity))
    }

    add('email_otp', 'DELETE FROM email_otp WHERE email = ?1', email)
    add('email_trial_sessions', 'DELETE FROM email_trial_sessions WHERE email = ?1', email)
    // Proxy content is recorded under a disjoint trial identity even though
    // authentication/session tables use the normalized raw email. Usage and
    // quota rows are retained as anti-abuse/accounting records.
    add('memory', 'DELETE FROM memory WHERE user_id = ?1', trialIdentity)
    add('shared_conversations', 'DELETE FROM shared_conversations WHERE owner_email = ?1', trialIdentity)
    add('content_reports', 'DELETE FROM content_reports WHERE reporter_email = ?1', trialIdentity)
    add('content_reports', 'DELETE FROM content_reports WHERE reporter_email = ?1', legacyTrialReportIdentity)

    if (kind === 'google') {
      add('memory', 'DELETE FROM memory WHERE user_id = ?1', email)
      add('shared_conversations', 'DELETE FROM shared_conversations WHERE owner_email = ?1', email)
      add('content_reports', 'DELETE FROM content_reports WHERE reporter_email = ?1', email)
    }

    // D1 batch is transactional: an unavailable table or failed statement
    // rejects the request instead of returning a misleading { ok: true }.
    if (statements.length > 0) await env.DB.batch(statements)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[account/delete] erasure failed', err)
    return Response.json({ error: 'Account deletion incomplete' }, { status: 500 })
  }
}
