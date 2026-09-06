import { useCallback, useEffect, useRef, useState } from 'react'
import { onLocalDataInvalidated } from '../services/localDataInvalidation'
import { onGoogleGrantInvalidated } from '../services/googleAuth'
import { connectionPlatform, readConnectionsSnapshot } from '../services/connectionsStatus'
import { documentWorkspaceSignal } from '../services/workspaceWriter/runtime'

/** No network/refresh/bootstrap. Old actions never adopt a replacement scope. */
export function useConnectionsStatus() {
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof readConnectionsSnapshot>> | null>(null)
  const [state, setState] = useState<'loading' | 'unavailable' | 'ready'>('loading')
  const receiptRef = useRef(receipt); receiptRef.current = receipt
  const attempt = useRef<AbortController | null>(null), alive = useRef(true)
  const refresh = useCallback(async () => {
    if (!alive.current || documentWorkspaceSignal.aborted) return
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
    let queued = false, disposed = false
    const invalidate = () => {
      attempt.current?.abort(); receiptRef.current = null; setReceipt(null); setState('loading')
      if (documentWorkspaceSignal.aborted) { setState('unavailable'); return }
      // Grant revocation can be reentrant inside a sync reader. Wait for its
      // writer to finish; never start a refresh/bootstrap as a reaction.
      if (!queued) { queued = true; queueMicrotask(() => { queued = false; if (!disposed && alive.current) void refresh() }) }
    }
    const offData = onLocalDataInvalidated(invalidate), offGoogle = onGoogleGrantInvalidated(invalidate)
    const retire = () => {
      attempt.current?.abort(); receiptRef.current = null; setReceipt(null); setState('unavailable')
    }
    documentWorkspaceSignal.addEventListener('abort', retire, { once: true })
    if (documentWorkspaceSignal.aborted) retire()
    const events = ['google-storage-ready', 'mail-accounts-updated', 'arty-active-keys-changed', 'storage', 'focus']
    for (const event of events) window.addEventListener(event, invalidate)
    const timer = setInterval(() => { try { receiptRef.current?.assertCurrent() } catch { invalidate() } }, 250)
    return () => { disposed = true; alive.current = false; attempt.current?.abort(); offData(); offGoogle(); documentWorkspaceSignal.removeEventListener('abort', retire); clearInterval(timer); for (const event of events) window.removeEventListener(event, invalidate) }
  }, [refresh])
  // Each render's callback belongs to that receipt, not a later ref value.
  const act = useCallback((action: () => void) => {
    if (!alive.current || documentWorkspaceSignal.aborted || !receipt) return
    try { receipt.assertCurrent() } catch { void refresh(); return }
    action()
  }, [receipt, refresh])
  return { snapshot: receipt?.snapshot ?? null, state, refresh, act, platform: connectionPlatform() }
}
