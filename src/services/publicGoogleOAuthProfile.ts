/**
 * Profil OAuth permanent du client public : aucun scope Google restreint.
 * Il n'existe plus de branche de rollback capable de réactiver les anciens
 * connecteurs depuis une variable de build. Une future intégration devra être
 * ajoutée explicitement avec ses propres scopes et contrôles de conformité.
 */
export function isPublicGoogleOAuthProfileEnabled(): true {
  return true
}

export const BLOCKED_PUBLIC_GOOGLE_TOOL_NAMES = new Set([
  'list_drive',
  'search_drive',
  'read_drive_file',
  'create_drive_file',
  'share_drive_file',
  'delete_drive_file',
  'search_contacts',
  'create_contact',
  'update_contact',
  'delete_contact',
  // Sheets is one of the four tombstoned connectors (CDC D26/D29). Phase 0
  // forgot to gate it client-side — fixed with the PR-0 tombstones.
  'export_clients_to_sheets',
  'export_projets_to_sheets',
])

export function isBlockedPublicGoogleTool(name: string): boolean {
  return BLOCKED_PUBLIC_GOOGLE_TOOL_NAMES.has(name)
}
