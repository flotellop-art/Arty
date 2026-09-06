export type EntryRoute = 'private' | 'share' | 'landing' | 'workspace-setup'

/** Routing reads only: do not import userSession (its cache must first hydrate
 * AFTER acquisition), useAuth, crypto, or preview seeding from the public boot.
 * Presence/corrupt storage errs toward the locked private entry. These are not
 * authentication decisions. Explicit /discover is always a public brochure. */
export function getWorkspaceEntryRoute(
  pathname: string, search: string, native: boolean, previewBuild: boolean,
  storage: Pick<Storage, 'getItem'>,
): EntryRoute {
  if (pathname === '/workspace/prepare') return 'workspace-setup'
  if (/^\/share\/[^/]+\/?$/.test(pathname)) return 'share'
  if (pathname === '/discover' || pathname === '/discover/') return 'landing'
  if (pathname !== '/' || native || previewBuild || new URLSearchParams(search).has('start')) return 'private'
  try {
    if (storage.getItem('arty-active-session')) return 'private'
    if (storage.getItem('arty-onboarding-choice-done') === '1') return 'private'
    const known = storage.getItem('arty-known-sessions')
    if (known) { const parsed: unknown = JSON.parse(known); if (!Array.isArray(parsed) || parsed.length !== 0) return 'private' }
    return 'landing'
  } catch { return 'private' }
}
