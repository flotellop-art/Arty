import { restoreFail as fail } from '../workspaceWriter/restoreJournal'

/** Conservative collision inventory: include strings even outside identity
 * fields in the bounded history. Never truncate and then claim an ID is free.
 * Repeated/empty strings and physical rows also consume work budget. */
export function createSyncIdentityInventory() {
  const ids = new Set<string>(), seen = new Set<object>()
  let nodes = 0, chars = 0, rows = 0, failed = false
  const refuse = (code: 'limit' | 'format') => { failed = true; return fail(code) }
  const current = () => { if (failed) return fail('limit') }
  const inspect = (value: unknown) => {
    current()
    const stack: unknown[] = [value]
    while (stack.length) {
      if (++nodes > 1_000_000) return refuse('limit')
      const next = stack.pop()
      if (typeof next === 'string') {
        // Charge occurrences, not only unique strings, before retaining them.
        chars += next.length
        if (chars > 32 * 1024 * 1024 || !ids.has(next) && ids.size >= 100_000) return refuse('limit')
        ids.add(next)
      } else if (next && typeof next === 'object' && !seen.has(next)) {
        seen.add(next)
        for (const key in next) if (Object.prototype.hasOwnProperty.call(next, key)) {
          if (nodes + stack.length >= 1_000_000) return refuse('limit')
          stack.push((next as Record<string, unknown>)[key])
        }
      }
    }
  }
  return Object.freeze({ inspect, has(id: string) { current(); return ids.has(id) }, inspectRow(key: unknown, value: unknown) {
    current()
    if (++rows > 100_000) return refuse('limit')
    inspect(key)
    if (!value || typeof value !== 'object') return refuse('format')
    const row = value as Record<string, unknown>
    for (const field of ['id', 'fileId', 'projectId']) {
      if (row[field] !== undefined && typeof row[field] !== 'string') return refuse('format')
      inspect(row[field])
    }
  } })
}
