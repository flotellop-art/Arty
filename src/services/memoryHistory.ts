/**
 * Memory change history (Feature 11). FIFO, max 50 entries.
 */

import * as scoped from './scopedStorage'
import { generateId } from '../utils/generateId'

const KEY = 'memory-history'
const MAX_ENTRIES = 50

export interface MemoryHistoryEntry {
  id: string
  timestamp: number
  category: string
  action: string
  details: string
  /** Previous value snapshot (for undo). */
  previousValue?: unknown
}

export function getMemoryHistory(): MemoryHistoryEntry[] {
  return scoped.getJSON<MemoryHistoryEntry[]>(KEY) || []
}

export function logChange(
  category: string,
  action: string,
  details: string,
  previousValue?: unknown
): void {
  const history = getMemoryHistory()
  history.unshift({
    id: generateId(),
    timestamp: Date.now(),
    category,
    action,
    details,
    previousValue,
  })
  // FIFO — keep only the last MAX_ENTRIES
  const trimmed = history.slice(0, MAX_ENTRIES)
  scoped.setJSON(KEY, trimmed)
  window.dispatchEvent(new CustomEvent('memory-history-updated'))
}

export function clearMemoryHistory(): void {
  scoped.setJSON(KEY, [])
  window.dispatchEvent(new CustomEvent('memory-history-updated'))
}

/**
 * Revert the last recorded change in a given category by calling updateMemory
 * with the stored previous value.
 */
export async function revertLastChange(category: string): Promise<boolean> {
  const history = getMemoryHistory()
  const idx = history.findIndex((e) => e.category === category && e.previousValue !== undefined)
  if (idx === -1) return false
  const entry = history[idx]!
  try {
    const { updateMemory } = await import('./memoryService')
    await updateMemory(entry.category as 'profil' | 'clients' | 'chantiers' | 'notes', entry.previousValue)
    // Remove the reverted entry from history
    history.splice(idx, 1)
    scoped.setJSON(KEY, history)
    window.dispatchEvent(new CustomEvent('memory-history-updated'))
    return true
  } catch {
    return false
  }
}
