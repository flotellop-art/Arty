import type { PlanStatus } from '../../hooks/usePlanStatus'
import { findModel, type PanelConfig } from './providerCatalog'

/** Eligibility hint only; auth, remaining quotas, key validity and fallback
 * remain server decisions. Trial mirrors its EXISTING allowlist, not Auto routing.
 */
export function panelAccess(config: PanelConfig, context: {
  plan: PlanStatus; authenticated: boolean; personalKey: boolean; trialRemaining: number | null
}): string | null {
  const model = findModel(config.provider, config.modelId)
  if (!model) return 'compare.access.unknownModel'
  if (!context.authenticated || context.plan.authRejected || context.plan.authRequired) return 'compare.access.auth'
  if (context.personalKey) return null
  const { plan } = context
  if (plan.loading || plan.statusUnavailable) return 'compare.access.unverified'
  if (plan.plan === 'pro') return 'compare.access.byok'
  if (plan.plan === 'free') {
    if (context.trialRemaining !== null && context.trialRemaining > 0) return model.trial ? null : 'compare.access.trial'
    // Wallet unlock is reflected by usePlanStatus only after trial exhaustion.
    if (context.trialRemaining === 0 && plan.allowedFamilies.length <= 1) return 'compare.access.plan'
  }
  return plan.allowedFamilies.some(f => f === model.family) ? null : 'compare.access.plan'
}
