import { getActiveSessionEpoch, getActiveUserId } from './userSession'

// In-document work, including streaming and its preparation. Epoch namespacing prevents a
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
/** Includes preparations which have not created a durable conversation yet. */
export function hasActiveConversationWork(): boolean {
  const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
  for (const key of jobs.keys()) {
    const [jobOwner, jobEpoch] = JSON.parse(key) as [string | null, number, string]
    if (jobOwner === owner && jobEpoch === epoch) return true
  }
  return false
}
