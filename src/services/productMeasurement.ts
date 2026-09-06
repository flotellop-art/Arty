import { getActiveSession } from './userSession'
import { captureLocalReadScope } from './projects/store'
import { documentStorageKey, documentWorkspaceSignal } from './workspaceWriter/runtime'
import { captureGoogleGrant, captureReadyGoogleToken, onGoogleGrantInvalidated } from './googleAuth'
import { onLocalDataInvalidated } from './localDataInvalidation'
import { isNative } from './native/platform'
import { apiUrl } from './apiBase'
import { PRODUCT_MEASUREMENT_PATH, PRODUCT_MEASUREMENT_RELEASED, parseProductMeasurement } from './productMeasurementProtocol'
import type { WorkflowObservation, WorkflowOutcome } from './workflows/outcome'

export const PRODUCT_MEASUREMENT_SETTING = 'product-measurement-v1'
const pending = new Set<AbortController>(), disabledOwners = new Set<string>(), listeners = new Set<() => void>()
let consentEpoch = 0
const notify = () => { for (const listener of [...listeners]) { try { listener() } catch { /* isolated UI */ } } }
function invalidate() {
  consentEpoch++
  const old = [...pending]
  pending.clear()
  for (const controller of old) controller.abort()
}
onLocalDataInvalidated(() => { invalidate(); notify() })
onGoogleGrantInvalidated(invalidate)
documentWorkspaceSignal.addEventListener('abort', invalidate, { once: true })
window.addEventListener('beforeunload', invalidate)
window.addEventListener('pagehide', invalidate)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') invalidate() })
window.addEventListener('storage', event => {
  try {
    const owner = getActiveSession()?.userId
    if (event.key === null || (owner && event.key === documentStorageKey(owner, PRODUCT_MEASUREMENT_SETTING))) { invalidate(); notify() }
  } catch { invalidate(); notify() }
})

export function subscribeProductMeasurement(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function productMeasurementAvailable(): boolean {
  try { return PRODUCT_MEASUREMENT_RELEASED && !isNative && getActiveSession()?.authMethod === 'google' } catch { return false }
}
/** RAM withdrawal survives Settings unmounts. A read failure cannot turn an
 * unpersisted withdrawal into a durable-off claim. */
export function productMeasurementWithdrawalPending(): boolean {
  try {
    const owner = getActiveSession()?.userId
    if (!owner || !disabledOwners.has(owner)) return false
    try { return accepted(localStorage.getItem(documentStorageKey(owner, PRODUCT_MEASUREMENT_SETTING))) }
    catch { return true }
  } catch { return false }
}
function accepted(raw: string | null): boolean {
  if (!raw || raw.length > 128) return false
  try {
    const value = JSON.parse(raw)
    return value && Object.keys(value).length === 3 && value.version === 1 && value.enabled === true &&
      typeof value.generation === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.generation) &&
      raw === JSON.stringify({ version: 1, enabled: true, generation: value.generation })
  } catch { return false }
}
export function isProductMeasurementEnabled(): boolean {
  try {
    if (!productMeasurementAvailable()) return false
    const scope = captureLocalReadScope()
    return !disabledOwners.has(scope.owner) && accepted(localStorage.getItem(documentStorageKey(scope.owner, PRODUCT_MEASUREMENT_SETTING)))
  } catch { return false }
}
/** No write at mount. Failure is propagated to the UI; revocation in this
 * document is immediate even if storing OFF failed. Re-enable is explicit. */
export function setProductMeasurementEnabled(enabled: boolean): void {
  let owner: string | undefined
  try { owner = getActiveSession()?.userId } catch { /* OFF must still invalidate pending requests. */ }
  let scope: ReturnType<typeof captureLocalReadScope> | undefined
  try { scope = captureLocalReadScope() } catch { /* OFF still invalidates this document. */ }
  const expectedEpoch = consentEpoch + 1
  if (!enabled && owner) disabledOwners.add(owner)
  invalidate()
  try {
    if (!scope || scope.owner !== owner || expectedEpoch !== consentEpoch || !productMeasurementAvailable()) throw new Error('measurement_setting_unavailable')
    scope.assertCurrent()
    const key = documentStorageKey(scope.owner, PRODUCT_MEASUREMENT_SETTING)
    localStorage.setItem(key, JSON.stringify({ version: 1, enabled, generation: crypto.randomUUID() }))
    scope.assertCurrent()
    if (enabled) disabledOwners.delete(scope.owner)
  } finally { notify() }
}

const inert: WorkflowObservation = Object.freeze({ settle() {}, discard() {} })
/** Arm before the manual workflow starts. Nothing is serialized into history.
 * Completion is independent of the short form/stream AbortSignals. */
export function beginClientReplyMeasurement(): WorkflowObservation {
  try {
    if (!isProductMeasurementEnabled() || document.visibilityState === 'hidden') return inert
    const controller = new AbortController(), scope = captureLocalReadScope(controller.signal)
    const key = documentStorageKey(scope.owner, PRODUCT_MEASUREMENT_SETTING), raw = localStorage.getItem(key), epoch = consentEpoch
    const grant = captureGoogleGrant()
    if (!accepted(raw) || !grant?.isCurrent()) return inert
    const assertCurrent = () => {
      scope.assertCurrent()
      if (epoch !== consentEpoch || document.visibilityState === 'hidden' || disabledOwners.has(scope.owner) || !productMeasurementAvailable() ||
        localStorage.getItem(key) !== raw || !grant.isCurrent()) throw new Error('measurement_cancelled')
    }
    assertCurrent(); pending.add(controller)
    let terminal = false
    const cleanup = () => { pending.delete(controller); controller.abort() }
    const send = async (outcome: WorkflowOutcome) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        assertCurrent()
        const declaration = parseProductMeasurement({ version: 1, flow: 'client-reply', outcome, platform: 'web' })
        if (!declaration) return
        const body = JSON.stringify(declaration), token = captureReadyGoogleToken()
        if (!token) return
        timer = setTimeout(() => controller.abort(), 8_000)
        await scope.validateReadOnly(); assertCurrent()
        if (!token.isCurrent()) return
        // No await between final owner/consent/token proof and dispatch.
        const response = await fetch(apiUrl(PRODUCT_MEASUREMENT_PATH), {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-google-token': token.token },
          body, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
        })
        // No body/identity echoed into the app; uncertain acknowledgements are
        // never retried. A previously committed aggregate cannot be undone.
        void response.body?.cancel().catch(() => {})
      } catch { /* optional, no logs, retries, toasts, quota or workflow effects */ }
      finally { if (timer !== undefined) clearTimeout(timer); cleanup() }
    }
    return {
      settle(outcome) {
        if (terminal) return
        terminal = true
        // Consume synchronously, dispatch only after finalizer/UI teardown.
        void Promise.resolve().then(() => send(outcome))
      },
      discard() { if (terminal) return; terminal = true; cleanup() },
    }
  } catch { return inert }
}
