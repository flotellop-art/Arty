import type { Env } from '../../../env'
import { maybeCleanup } from '../../_lib/atomicQuota'
import {
  checkRequestOtpRateLimit,
  isDisposableDomain,
  isValidEmail,
  normalizeEmail,
  sendOtpEmail,
  storeOtp,
  verifyTurnstile,
} from '../../_lib/emailTrial'

/**
 * POST /api/auth/email/request-otp  — body { email, turnstileToken? }
 *
 * Envoie un code OTP 6 chiffres par email (Resend) pour démarrer un essai sans
 * Google. CSRF/Origin assuré par le middleware (Origin whitelisté exigé).
 *
 * Audit sécu (RÈGLE 6) :
 *  - Auth : aucune par nature (signup) → bornée par Turnstile (si configuré) +
 *    rate-limit D1 FAIL-CLOSED (email/jour + IP/heure).
 *  - Abus infra : email-bombing + coût Resend bornés par les plafonds ci-dessus ;
 *    clé HMAC + Resend serveur-only (jamais VITE_).
 *  - Leak : pas de distinction « email connu/inconnu » — l'endpoint ne consulte
 *    aucun compte ; réponse uniforme.
 *  - Origin/CSRF : middleware (`_middleware.ts`).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB || !env.EMAIL_TRIAL_SECRET || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return Response.json({ error: 'email_trial_unavailable' }, { status: 503 })
  }

  let email: string
  let turnstileToken: string | null = null
  try {
    const body = (await request.json()) as { email?: unknown; turnstileToken?: unknown }
    if (typeof body.email !== 'string') return Response.json({ error: 'invalid_email' }, { status: 400 })
    email = body.email
    if (typeof body.turnstileToken === 'string') turnstileToken = body.turnstileToken
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!isValidEmail(email)) {
    return Response.json({ error: 'invalid_email' }, { status: 400 })
  }
  const normalized = normalizeEmail(email)
  if (isDisposableDomain(normalized)) {
    return Response.json({ error: 'disposable_email' }, { status: 400 })
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown'

  const captchaOk = await verifyTurnstile(env, turnstileToken, ip)
  if (!captchaOk) {
    return Response.json({ error: 'captcha_failed' }, { status: 403 })
  }

  const rateOk = await checkRequestOtpRateLimit(env, normalized, ip)
  if (!rateOk) {
    return Response.json({ error: 'rate_limited' }, { status: 429 })
  }

  const code = await storeOtp(env, normalized)
  if (!code) {
    return Response.json({ error: 'email_trial_unavailable' }, { status: 503 })
  }

  // Envoi au DESTINATAIRE saisi (pas à l'email normalisé : l'alias `+tag` doit
  // arriver dans la bonne boîte), mais l'OTP est keyé sur l'email normalisé.
  const sent = await sendOtpEmail(env, email.trim(), code)
  if (!sent) {
    return Response.json({ error: 'send_failed' }, { status: 502 })
  }

  // Purge paresseuse des lignes périmées (D1 n'a pas de TTL natif).
  await maybeCleanup(env, `DELETE FROM email_otp WHERE expires_at < unixepoch()`, [])
  await maybeCleanup(env, `DELETE FROM otp_rate WHERE expires_at < unixepoch()`, [])

  return Response.json({ ok: true })
}
