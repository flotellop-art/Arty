import { getActiveSessionEpoch, getActiveUserId } from './userSession'

export interface InvocationAuthority {
  readonly signal?: AbortSignal
  assertCurrent(): void
}

/** Capture once, then check after every await and immediately before effects. */
export function captureInvocationAuthority(parent?: InvocationAuthority): InvocationAuthority {
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
  return { signal: parent?.signal, assertCurrent() {
    parent?.signal?.throwIfAborted()
    parent?.assertCurrent()
    if (owner !== getActiveUserId() || epoch !== getActiveSessionEpoch()) {
      throw new DOMException('Request cancelled: account changed', 'AbortError')
    }
  } }
}
