import { useCallback, useEffect, useRef, useState } from 'react'
import { captureCalendarDocumentCopy, CalendarCopyError, type CalendarDocumentCopy } from '../../services/workflows/calendarDocumentCopy'
import { CalendarError } from '../../services/calendarClient'
import { onGoogleGrantInvalidated } from '../../services/googleAuth'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'
import { documentWorkspaceSignal } from '../../services/workspaceWriter/runtime'

export interface CalendarCopyOpening { conversationId: string; key: number; actor?: CalendarDocumentCopy; error?: unknown; done?: boolean }
/** Parent owns the opening, not a lazy import or the dialog's StrictMode probe. */
export function useCalendarDocumentCopy(conversationId: string, isBusy: (id: string) => boolean) {
  const active = useRef<CalendarCopyOpening | null>(null), busy = useRef(isBusy)
  const serial = useRef(0)
  busy.current = isBusy
  const [opening, setOpening] = useState<CalendarCopyOpening | null>(null)
  const close = useCallback(() => {
    active.current?.actor?.dispose(); active.current = null; setOpening(null)
  }, [])
  useEffect(() => {
    setOpening(null)
    const revoke = () => {
      const old = active.current
      if (!old?.actor) return
      const done = old.actor.hasConfirmed
      const error = done ? undefined : old.actor.hasAttempted ? new CalendarError('unknown') : new CalendarCopyError('changed')
      old.actor.dispose()
      const next = { conversationId: old.conversationId, key: ++serial.current, error, done }
      active.current = next; setOpening(next)
    }
    const unsubscribe = onLocalDataInvalidated(revoke), ungrant = onGoogleGrantInvalidated(revoke)
    documentWorkspaceSignal.addEventListener('abort', revoke)
    return () => {
      unsubscribe(); ungrant(); documentWorkspaceSignal.removeEventListener('abort', revoke)
      active.current?.actor?.dispose(); active.current = null
    }
  }, [conversationId])
  const open = useCallback((messageId: string) => {
    if (active.current) return
    // No await before source, owner, crypto and Google authority capture.
    let next: CalendarCopyOpening
    const key = ++serial.current
    try { next = { conversationId, key, actor: captureCalendarDocumentCopy(conversationId, messageId, { isBusy: id => busy.current(id) }) } }
    catch (error) { next = { conversationId, key, error } }
    active.current = next; setOpening(next)
  }, [conversationId])
  return { opening: opening?.conversationId === conversationId ? opening : null, open, close }
}
