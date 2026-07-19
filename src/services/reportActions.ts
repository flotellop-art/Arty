// Actions HTML qu'un rapport Arty est autorisé à rendre cliquables.
// Cette allowlist est partagée par le renderer et le dispatcher : un ancien
// message stocké ne peut donc pas réactiver une action supprimée du produit.
export const REPORT_ACTION_NAMES = new Set([
  'reply',
  'create_event',
  'publish_wp',
  'search_web',
  'call',
  'link',
  'view_trail',
])

export function isAllowedReportAction(action: string): boolean {
  return REPORT_ACTION_NAMES.has(action)
}

// Compatibilité des anciens messages stockés. Les nouveaux boutons view_trail
// n'exposent plus cet id OSM : ils utilisent parseTrailSnapshotId ci-dessous.
// Un id de relation OSM est un entier positif ; on borne à 15 chiffres.
export function parseTrailRouteId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

// Référence locale opaque vers un TrailSnapshot IndexedDB. La validation de
// forme est suivie d'un lookup local sur la page : un UUID inventé par le LLM
// reste donc inerte et ne peut pas être converti en id de relation OSM.
const TRAIL_SNAPSHOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseTrailSnapshotId(raw: unknown): string | null {
  if (typeof raw !== 'string' || !TRAIL_SNAPSHOT_ID.test(raw)) return null
  return raw.toLowerCase()
}
