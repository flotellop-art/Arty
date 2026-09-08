import type { Env } from '../../env'
import { admissionUnavailable, isAdmissionUnavailable } from './admission'
import { checkAllowedVerifiedUserPeek, type CheckResult, type PlanType } from './checkAllowedUser'
import { readTrialCounterRemaining } from './trialAdmission'

/** Server-funded extras are a plan benefit, not an undeclared wallet debit. */
export function hasPaidFeatures(plan: PlanType): boolean {
  return plan === 'subscription' || plan === 'pro' || plan === 'vip'
}

export function paidFeatureResponse(): Response {
  return Response.json({ error: 'paid_feature_required', message: "L’essai comprend le chat Haiku et sa recherche web. Cette fonction nécessite un accès payant." },
    { status: 403, headers: { 'cache-control': 'no-store' } })
}

/** No trial write. BYOK is selected by the caller before this check. An
 * exhausted Google trial may still use the existing, actually billed wallet.
 * An active trial must never silently fall through to that paid path. */
export async function resolveNonTrialChatAccess(
  identity: { kind: 'google' | 'email-trial'; email: string }, env: Env,
): Promise<CheckResult | Response> {
  if (identity.kind === 'email-trial') return paidFeatureResponse()
  const user = await checkAllowedVerifiedUserPeek(identity.email, env)
  if (isAdmissionUnavailable(user) || user.planType !== 'trial') return user
  const remaining = await readTrialCounterRemaining(env, user.email, 'trial_usage')
  if (remaining === null) return admissionUnavailable()
  return remaining === 0 ? { error: 'trial_expired', email: user.email } : paidFeatureResponse()
}
