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
])

export function isAllowedReportAction(action: string): boolean {
  return REPORT_ACTION_NAMES.has(action)
}
