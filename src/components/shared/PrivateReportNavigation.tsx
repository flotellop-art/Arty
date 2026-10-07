import { useCallback, type ReactNode } from 'react'
import { LocalReportNavigationContext } from './LocalReportNavigationContext'
import { getActiveSessionEpoch, getActiveUserId } from '../../services/userSession'
import { storedLocalReportPath } from '../../services/storedLocalReportLink'

export function PrivateReportNavigation({ owner, children }: { owner: string | null; children: ReactNode }) {
  const resolve = useCallback((href: string) => {
    try {
      if (!owner || getActiveUserId() !== owner) return null
      // Capture per rendered link, not once at provider mount: a later session
      // can resolve new links, but cannot activate an old session's link.
      const epoch = getActiveSessionEpoch()
      const path = storedLocalReportPath(href)
      if (!path) return null
      return { path, canNavigate: () => {
        try {
          return getActiveUserId() === owner && getActiveSessionEpoch() === epoch && storedLocalReportPath(href) === path
        } catch { return false }
      } }
    } catch { return null }
  }, [owner])
  return <LocalReportNavigationContext.Provider value={resolve}>{children}</LocalReportNavigationContext.Provider>
}
