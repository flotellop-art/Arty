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

// view_trail — le data-route-id vient d'un bouton généré par le LLM (donc
// potentiellement d'une prompt-injection, classe BUG 32) : validation stricte
// AVANT toute navigation, en défense en profondeur du contrôle serveur.
// Un id de relation OSM est un entier positif ; on borne à 15 chiffres.
export function parseTrailRouteId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
