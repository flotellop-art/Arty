const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

/**
 * Build-time switch for the reversible Gmail-without-CASA prototype.
 * It is intentionally off unless the preview build opts in explicitly.
 */
export function isGmailNoCasaPhase0Enabled(
  value: string | undefined = import.meta.env.VITE_GMAIL_NO_CASA_PHASE0,
): boolean {
  return value !== undefined && TRUE_VALUES.has(value.trim().toLowerCase())
}

export const NO_CASA_BLOCKED_TOOL_NAMES = new Set([
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
])

export function isNoCasaBlockedTool(name: string): boolean {
  return NO_CASA_BLOCKED_TOOL_NAMES.has(name)
}
