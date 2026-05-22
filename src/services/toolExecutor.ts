import type { useComputer } from '../hooks/useComputer'
import type { useGmail } from '../hooks/useGmail'
import type { useDrive } from '../hooks/useDrive'
import type { useBrowser } from '../hooks/useBrowser'
import type { ToolResult, ToolHandler } from './tools/types'
import { createComputerHandlers } from './tools/computerTools'
import { createGmailHandlers } from './tools/gmailTools'
import { createDriveHandlers } from './tools/driveTools'
import { createCalendarHandlers } from './tools/calendarTools'
import { createContactsHandlers } from './tools/contactsTools'
import { createWordpressHandlers } from './tools/wordpressTools'
import { createUtilityHandlers } from './tools/utilityTools'
import { createNativeHandlers } from './tools/nativeTools'
import { createSheetsHandlers } from './tools/sheetsTools'
import { ENABLE_RESTRICTED_GOOGLE_FEATURES } from '../config'

export type { ToolResult, ToolHandler }

const RESTRICTED_TOOLS = new Set([
  // Gmail (except send_email)
  'read_emails', 'read_email', 'read_email_attachment', 'reply_email', 'search_emails',
  'archive_email', 'delete_email', 'star_email', 'create_draft_email', 'label_email',
  // Drive
  'list_drive', 'search_drive', 'read_drive_file', 'create_drive_file', 'delete_drive_file',
  'rename_drive_file', 'move_drive_file', 'create_drive_folder', 'share_drive_file', 'copy_drive_file',
  // Sheets
  'export_clients_to_sheets', 'export_projets_to_sheets'
])

export function createToolExecutor(
  computer: ReturnType<typeof useComputer>,
  gmail: ReturnType<typeof useGmail>,
  drive: ReturnType<typeof useDrive>,
  browserActions: ReturnType<typeof useBrowser>,
) {
  const handlers: Record<string, ToolHandler> = {
    ...createComputerHandlers(computer),
    ...createGmailHandlers(gmail),
    ...createDriveHandlers(drive),
    ...createCalendarHandlers(),
    ...createContactsHandlers(),
    ...createWordpressHandlers(browserActions),
    ...createUtilityHandlers(browserActions),
    ...createNativeHandlers(),
    ...createSheetsHandlers(),
  }

  return async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    if (!ENABLE_RESTRICTED_GOOGLE_FEATURES && RESTRICTED_TOOLS.has(name)) {
      return { result: `Outil indisponible dans cette version d'Arty: ${name}` }
    }
    const handler = handlers[name]
    if (!handler) return { result: `Outil inconnu: ${name}` }
    try {
      return await handler(input)
    } catch (err) {
      return { result: `Erreur: ${err instanceof Error ? err.message : 'inconnue'}` }
    }
  }
}
