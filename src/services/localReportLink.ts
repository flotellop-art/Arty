import { getActiveUserId } from './userSession'

// A saved local resource is navigable, not an externally verified source.
// Never exempt the entire localhost origin from link verification.
export function storedLocalReportPath(value: string): string | null {
  try {
    const owner = getActiveUserId()
    if (!owner || typeof window === 'undefined') return null
    const url = new URL(value, window.location.origin)
    if (url.origin !== window.location.origin || url.username || url.password || url.search || url.hash) return null
    const match = /^\/report\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(url.pathname)
    if (!match || !localStorage.getItem(`arty-${owner}-report-${match[1]}`)) return null
    return url.pathname
  } catch {
    return null
  }
}
