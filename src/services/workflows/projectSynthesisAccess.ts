import type { PlanStatus } from '../../hooks/usePlanStatus'
import { getActiveSession } from '../userSession'
import { hasPersonalKey } from '../providerLock'
import { getTrialRemaining } from '../trialClient'
import { panelAccess } from '../comparator/access'
import { gatherRouteInput, classifyRouteAttachments } from '../router/gatherRouteInput'
import { canExecuteRoute, resolveRoute } from '../router/resolveRoute'
import { TEXT_DEFAULTS } from '../modelCatalog'

/** Eligibility hint for the exact documentary route; never a quota receipt. */
export function projectSynthesisAccess(plan: PlanStatus, euOnly: boolean, question: string) {
  const input = gatherRouteInput({ originalText: question, ...classifyRouteAttachments(null), euOnly,
    hasPrivateHistory: false, hasProjectContext: true })
  const route = resolveRoute(input)
  const provider = euOnly ? 'mistral' : 'anthropic'
  const modelId = euOnly ? TEXT_DEFAULTS.mistralChat : route.subModel ?? TEXT_DEFAULTS.sonnet
  const error = panelAccess({ id: 'synthesis', provider, modelId }, {
    plan, authenticated: !!getActiveSession() && getActiveSession()?.authMethod !== 'demo',
    personalKey: hasPersonalKey(provider), trialRemaining: getTrialRemaining(),
  })
  return { provider, modelId, error: error ?? (!canExecuteRoute(input) ? 'compare.access.plan' : null) }
}
