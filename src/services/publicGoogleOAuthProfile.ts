const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

/**
 * Public-client OAuth profile (no restricted Google scopes → no CASA).
 * Definitive names per CDC Phase 1 D21/D26 (docs/CAHIER_DES_CHARGES_SANS_CASA_PHASE1_DRIVE_GMAIL.md).
 *
 * The EXTERNAL switch names are kept as historical aliases on purpose
 * (renaming them would silently desync from the deployed Cloudflare/Gradle
 * config — the BUG 40 class of failure):
 *   - web build:     VITE_GMAIL_NO_CASA_PHASE0 (Cloudflare Pages env)
 *   - android build: ARTY_GMAIL_NO_CASA_PHASE0 → BuildConfig.GMAIL_NO_CASA_PHASE0
 * Their renaming is a separate ops step coordinated with the dashboards.
 */
export function isPublicGoogleOAuthProfileEnabled(
  value: string | undefined = import.meta.env.VITE_GMAIL_NO_CASA_PHASE0,
): boolean {
  return value !== undefined && TRUE_VALUES.has(value.trim().toLowerCase())
}

export const BLOCKED_PUBLIC_GOOGLE_TOOL_NAMES = new Set([
  'read_emails',
  'read_email',
  'read_email_attachment',
  'search_emails',
  'send_email',
  'reply_email',
  'modify_email',
  'create_draft',
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
