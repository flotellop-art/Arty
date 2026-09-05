/** No identities, keys or content. UI invalidation must never break auth/storage. */
const listeners = new Set<() => void>()
export function onLocalDataInvalidated(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function invalidateLocalDataViews(): void {
  for (const listener of [...listeners]) { try { listener() } catch { /* isolate each observer */ } }
}
