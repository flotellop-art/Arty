import type { Env } from '../../env'
import { verifyGoogleUserStrict } from '../_lib/checkAllowedUser'
import { verifyEmailTrialToken } from '../_lib/emailTrial'
import { accountErasureStatements } from '../_lib/accountErasureData'

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

  try {
    const statements = await accountErasureStatements(env.DB, email, kind)

    // D1 batch is transactional: an unavailable table or failed statement
    // rejects the request instead of returning a misleading { ok: true }.
    if (statements.length > 0) await env.DB.batch(statements)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[account/delete] erasure failed', err)
    return Response.json({ error: 'Account deletion incomplete' }, { status: 500 })
  }
}
