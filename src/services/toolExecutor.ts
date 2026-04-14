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

export type { ToolResult, ToolHandler }

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
    const handler = handlers[name]
    if (!handler) return { result: `Outil inconnu: ${name}` }
    try {
      return await handler(input)
    } catch (err) {
      return { result: `Erreur: ${err instanceof Error ? err.message : 'inconnue'}` }
    }
  }
}
