import { captureGoogleGrant, onGoogleGrantInvalidated } from './googleAuth'
import { getActiveSessionEpoch, getActiveUserId } from './userSession'

// Local provenance only, never a replacement for server authorization.
// Lazy registration keeps imports inert before private workspace admission.
let generation = 0, observing = false
const listeners = new Set<() => void>()
function observe(): void {
  if (observing) return
  observing = true
  onGoogleGrantInvalidated(() => {
    generation += 1
    for (const listener of [...listeners]) { try { listener() } catch { /* isolate observers */ } }
  })
}
export function onBillingContextInvalidated(listener: () => void): () => void {
  observe(); listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Capture BEFORE any await. A relink of the same account is a new context;
 * a normal access-token refresh is not. No bootstrap/OAuth from invalidation. */
export function captureBillingContext() {
  observe()
  try {
    const owner = getActiveUserId(), epoch = getActiveSessionEpoch(), revision = generation
    const grant = captureGoogleGrant()
    const isCurrent = () => {
      try {
        return getActiveUserId() === owner && getActiveSessionEpoch() === epoch
          && generation === revision && (grant ? grant.isCurrent() : captureGoogleGrant() === null)
          && generation === revision && getActiveUserId() === owner && getActiveSessionEpoch() === epoch
      } catch { return false } // document authority may have been lost
    }
    return { isCurrent, getAccessToken: async () => {
      try {
        if (!isCurrent()) return null
        const token = await grant?.getAccessToken()
        return isCurrent() ? token ?? null : null
      } catch { return null }
    } }
  } catch {
    return { isCurrent: () => false, getAccessToken: async () => null }
  }
}
export type BillingContext = ReturnType<typeof captureBillingContext>
