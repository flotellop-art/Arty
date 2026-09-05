import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectReview, ProjectSelection, ReviewProjectRequest } from '../services/projects/chatPreparation'

type Answer = ProjectSelection | boolean | null
export function useProjectReview() {
  const [request, setRequest] = useState<(ProjectReview & { reviewId: number }) | null>(null)
  const pending = useRef<{ id: number; finish: (answer: Answer) => void } | null>(null)
  const serial = useRef(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.finish(null) } }, [])
  const review = useCallback<ReviewProjectRequest>((value, signal) => {
    if (!alive.current || signal.aborted || pending.current) return Promise.resolve(null)
    return new Promise<Answer>(resolve => {
      const id = ++serial.current
      const finish = (answer: Answer) => {
        if (pending.current?.id !== id) return
        pending.current = null; signal.removeEventListener('abort', abort)
        if (alive.current) setRequest(null)
        resolve(signal.aborted ? null : answer)
      }
      const abort = () => finish(null)
      pending.current = { id, finish }; signal.addEventListener('abort', abort, { once: true })
      setRequest({ ...value, reviewId: id })
    })
  }, [])
  const answer = useCallback((id: number, value: Answer) => { if (pending.current?.id === id) pending.current.finish(value) }, [])
  return { request, review, answer }
}
