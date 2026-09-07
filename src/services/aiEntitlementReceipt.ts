import i18n from '../i18n'
import { captureBillingContext, type BillingContext } from './billingContext'
import { getActiveUserId } from './userSession'
import { setTrialRemaining } from './trialClient'
import { markWalletReconciliationPending } from './walletClient'
import { walletReconciliationError } from './walletFailure'

// Retires only trial metadata from requests predating a terminal refusal.
// A new request can attest a later server compensation; zero is not permanent.
let trialRefusalRevision = 0

/** Pure formatting: callers without a request receipt cannot mutate funding. */
export function trialExpiredError(status: number, body: string): Error | null {
  if (status !== 403) return null
  try {
    if (JSON.parse(body)?.error !== 'trial_expired') return null
    return Object.assign(new Error(i18n.t('trial.expiredError')), { name: 'TrialExpiredError' })
  } catch { return null }
}

/** Capture before headers/await. This is local display provenance, not an
 * entitlement, credential, new request, or replacement for server checks. */
export function captureAiEntitlementReceipt(serverFunded: boolean, signal?: AbortSignal, assertRequestCurrent?: () => void) {
  let context: BillingContext | null = null, owner: string | null = null
  try { context = captureBillingContext(); owner = getActiveUserId() } catch { /* retired private document: inert receipt */ }
  const revision = trialRefusalRevision
  const isCurrent = () => {
    try {
      if (!serverFunded || !owner || signal?.aborted || !context?.isCurrent()) return false
      assertRequestCurrent?.()
      return !signal?.aborted && context.isCurrent()
    } catch { return false }
  }
  return {
    updateTrial(response: Response): void {
      const raw = response.headers.get('x-trial-remaining')
      if (raw === null || !/^(?:[0-9]|[12][0-9]|30)$/.test(raw)) return
      if (isCurrent() && revision === trialRefusalRevision) setTrialRemaining(Number(raw))
    },
    error(status: number, body: string): Error | null {
      const trial = trialExpiredError(status, body)
      if (trial) {
        if (isCurrent() && revision === trialRefusalRevision) {
          trialRefusalRevision += 1
          setTrialRemaining(0)
        }
        return trial
      }
      const wallet = walletReconciliationError(status, body)
      if (wallet && isCurrent() && context) markWalletReconciliationPending(context)
      return wallet
    },
  }
}
