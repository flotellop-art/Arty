import { ProjectError } from './types'

// Shared with crypto provisioning; no crypto, session, DB or known-membership
// dependency. Starting erasure invalidates every previously captured proof,
// even before its first asynchronous durable marker/server request.
const deletingOwners = new Set<string>()
const generations = new Map<string, number>()
export function captureOwnerErasureGuard(owner: string | null): () => void {
  if (owner !== null && deletingOwners.has(owner)) throw new ProjectError('unavailable')
  const generation = owner === null ? 0 : generations.get(owner) ?? 0
  return () => {
    if (owner !== null && (deletingOwners.has(owner) || generation !== (generations.get(owner) ?? 0))) throw new ProjectError('cancelled')
  }
}
export function blockProjectOperations(owner: string): () => void {
  if (deletingOwners.has(owner)) throw new ProjectError('unavailable')
  deletingOwners.add(owner)
  generations.set(owner, (generations.get(owner) ?? 0) + 1)
  let released = false
  return () => { if (!released) { released = true; deletingOwners.delete(owner) } }
}
