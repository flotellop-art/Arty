import { useCallback, useEffect, useRef, useState } from 'react'
import { onLocalDataInvalidated } from '../services/localDataInvalidation'
import { onGoogleGrantInvalidated } from '../services/googleAuth'
import { connectionPlatform, readConnectionsSnapshot } from '../services/connectionsStatus'
import { getActiveSession } from '../services/userSession'

/** No network/refresh/bootstrap. Old actions never adopt a replacement scope. */
export function useConnectionsStatus() {
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof readConnectionsSnapshot>> | null>(null)
  const [state, setState] = useState<'loading' | 'unavailable' | 'ready'>('loading')
  const receiptRef = useRef(receipt); receiptRef.current = receipt
  const attempt = useRef<AbortController | null>(null), alive = useRef(true)
  const refresh = useCallback(async () => {
    attempt.current?.abort(); const controller = new AbortController(); attempt.current = controller
    receiptRef.current = null; setReceipt(null); setState('loading')
    try {
      const next = await readConnectionsSnapshot(controller.signal)
      if (!alive.current || attempt.current !== controller) return
      next.assertCurrent(); receiptRef.current = next; setReceipt(next); setState('ready')
    } catch {
      if (alive.current && attempt.current === controller) { receiptRef.current = null; setReceipt(null); setState('unavailable') }
    }
  }, [])
  useEffect(() => {
    alive.current = true; void refresh()
    let queued = false
    const invalidate = () => {
      attempt.current?.abort(); receiptRef.current = null; setReceipt(null); setState('loading')
      // Grant revocation can be reentrant inside a sync reader. Wait for its
      // writer to finish; never start a refresh/bootstrap as a reaction.
      if (!queued) { queued = true; queueMicrotask(() => { queued = false; if (alive.current) void refresh() }) }
    }
    const offData = onLocalDataInvalidated(invalidate), offGoogle = onGoogleGrantInvalidated(invalidate)
    const events = ['google-storage-ready', 'mail-accounts-updated', 'arty-active-keys-changed', 'storage', 'focus']
    for (const event of events) window.addEventListener(event, invalidate)
    const timer = setInterval(() => { try { receiptRef.current?.assertCurrent() } catch { invalidate() } }, 250)
    return () => { alive.current = false; attempt.current?.abort(); offData(); offGoogle(); clearInterval(timer); for (const event of events) window.removeEventListener(event, invalidate) }
  }, [refresh])
  // Each render's callback belongs to that receipt, not a later ref value.
  const act = useCallback((action: () => void) => {
    if (!receipt) return
    try { receipt.assertCurrent(); action() } catch { void refresh() }
  }, [receipt, refresh])
  return { snapshot: receipt?.snapshot ?? null, state, refresh, act, platform: connectionPlatform(), demo: getActiveSession()?.authMethod === 'demo' }
}
