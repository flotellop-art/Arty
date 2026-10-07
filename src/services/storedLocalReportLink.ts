import { getActiveUserId } from './userSession'
import { localReportPath } from './localReportLink'

// Private app only. Presence permits navigation, never certifies report facts.
// Decryption/session guards remain in getReport. Never search another owner.
export function storedLocalReportPath(value: string): string | null {
  try {
    const path = localReportPath(value)
    if (!path) return null
    const owner = getActiveUserId()
    if (!owner) return null
    return localStorage.getItem(`arty-${owner}-report-${path.slice('/report/'.length)}`)
      ? path
      : null
  } catch {
    return null
  }
}
