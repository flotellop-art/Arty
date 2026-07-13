import type { useComputer } from '../hooks/useComputer'
import type { useGmail } from '../hooks/useGmail'
import type { useDrive } from '../hooks/useDrive'
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
import { createImageHandlers } from './tools/imageTools'
import { isGmailNoCasaPhase0Enabled, isNoCasaBlockedTool } from './gmailNoCasaPhase0'

export type { ToolResult, ToolHandler }

export function createToolExecutor(
  computer: ReturnType<typeof useComputer>,
  gmail: ReturnType<typeof useGmail>,
  drive: ReturnType<typeof useDrive>,
) {
  const handlers: Record<string, ToolHandler> = {
    ...createComputerHandlers(computer),
    ...createGmailHandlers(gmail),
    ...createDriveHandlers(drive),
    ...createCalendarHandlers(),
    ...createContactsHandlers(),
    ...createWordpressHandlers(),
    ...createUtilityHandlers(),
    ...createNativeHandlers(),
    ...createSheetsHandlers(),
    // P1.3 — toujours enregistré, mais le tool n'est exposé au modèle que
    // conditionnellement (cf. wantsImageGeneration dans useConversation).
    ...createImageHandlers(),
  }

  return async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    if (isGmailNoCasaPhase0Enabled() && isNoCasaBlockedTool(name)) {
      return {
        result: 'Ce build sans CASA ne donne pas à Arty un accès global à Gmail, Drive ou Contacts.',
      }
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
