import type { Env } from '../../../env'
import { maybeCleanup } from '../../_lib/atomicQuota'
import {
  checkVerifyOtpRateLimit,
  createSession,
  isValidEmail,
  normalizeEmail,
  verifyOtp,
} from '../../_lib/emailTrial'

/**
 * POST /api/auth/email/verify-otp  — body { email, code }
 *
 * Vérifie le code OTP et, si valide, émet un jeton de session email-trial
 * (opaque 256 bits, stocké HASHÉ en D1, révocable). Le client l'envoie ensuite
 * aux proxys IA via `x-arty-trial-token`.
 *
 * Audit sécu (RÈGLE 6) :
 *  - Auth : possession de l'OTP. Atomique (DELETE…RETURNING, single-use),
 *    max 5 tentatives/code, rate-limit verify par IP (anti « 1 code N comptes »).
 *  - Autorisation : émet un jeton SCOPE-TRIAL only (espace de clés disjoint).
 *  - Leak : ne distingue pas « code faux / expiré / trop de tentatives » (réponse
 *    unique invalid_code).
 *  - Origin/CSRF : middleware.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.EMAIL_TRIAL_SECRET) {
    return Response.json({ error: 'email_trial_unavailable' }, { status: 503 })
  }

  let email: string
  let code: string
  try {
    const body = (await request.json()) as { email?: unknown; code?: unknown }
    if (typeof body.email !== 'string' || typeof body.code !== 'string') {
      return Response.json({ error: 'invalid_request' }, { status: 400 })
    }
    email = body.email
    code = body.code.trim()
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return Response.json({ error: 'invalid_code' }, { status: 400 })
  }
  const normalized = normalizeEmail(email)
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'

  // Rate-limit par IP AVANT toute vérif (anti « 1 code, N comptes » : un même
  // code soumis contre N emails = N appels depuis la même IP).
  const rateOk = await checkVerifyOtpRateLimit(env, ip)
  if (!rateOk) {
    return Response.json({ error: 'rate_limited' }, { status: 429 })
  }

  const valid = await verifyOtp(env, normalized, code)
  if (!valid) {
    return Response.json({ error: 'invalid_code' }, { status: 400 })
  }

  const token = await createSession(env, normalized)
  if (!token) {
    return Response.json({ error: 'email_trial_unavailable' }, { status: 503 })
  }

  await maybeCleanup(
    env,
    `DELETE FROM email_trial_sessions WHERE expires_at < unixepoch()`,
    []
  )

  return Response.json({ token, email: normalized })
}
