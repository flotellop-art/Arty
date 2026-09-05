import { getActiveSessionEpoch, getActiveUserId } from './userSession'

// In-document work preceding/following streaming. Epoch namespacing prevents a
// late finally from clearing a newer account/operation's busy state.
const jobs = new Map<string, number>()
const keyFor = (id: string) => JSON.stringify([getActiveUserId(), getActiveSessionEpoch(), id])
export function beginConversationWork(id: string): () => void {
  const key = keyFor(id)
  jobs.set(key, (jobs.get(key) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (jobs.get(key) ?? 1) - 1
    if (count) jobs.set(key, count); else jobs.delete(key)
  }
}
export const hasConversationWork = (id: string): boolean => (jobs.get(keyFor(id)) ?? 0) > 0
