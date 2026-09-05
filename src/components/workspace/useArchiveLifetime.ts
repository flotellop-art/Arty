import { useEffect, useRef, useState } from 'react'
import { onLocalDataInvalidated } from '../../services/localDataInvalidation'
import { documentWorkspaceSignal } from '../../services/workspaceWriter/runtime'

/** Terminal revocation even when a same-account crypto reset keeps UI mounted.
 * Reopening the view is explicit; keys/results are never automatically revived. */
export function useArchiveLifetime(onInvalidate: () => void) {
  const [invalidated, setInvalidated] = useState(false)
  const invalid = useRef(false), callback = useRef(onInvalidate)
  callback.current = onInvalidate
  useEffect(() => {
    const revoke = () => { invalid.current = true; callback.current(); setInvalidated(true) }
    const unsubscribe = onLocalDataInvalidated(revoke)
    documentWorkspaceSignal.addEventListener('abort', revoke, { once: true })
    if (documentWorkspaceSignal.aborted) revoke()
    return () => { unsubscribe(); documentWorkspaceSignal.removeEventListener('abort', revoke) }
  }, [])
  return { invalidated, invalid }
}
