import type { useComputer } from '../hooks/useComputer'
import type { useDrive } from '../hooks/useDrive'
import type { ToolResult, ToolHandler } from './tools/types'
import { createComputerHandlers } from './tools/computerTools'
import { createDriveHandlers } from './tools/driveTools'
import { createCalendarHandlers } from './tools/calendarTools'
import { createContactsHandlers } from './tools/contactsTools'
import { createWordpressHandlers } from './tools/wordpressTools'
import { createUtilityHandlers } from './tools/utilityTools'
import { createTrailHandlers } from './tools/trailTools'
import { createNativeHandlers } from './tools/nativeTools'
import { createSheetsHandlers } from './tools/sheetsTools'
import { createImageHandlers } from './tools/imageTools'
import { isPublicGoogleOAuthProfileEnabled, isBlockedPublicGoogleTool } from './publicGoogleOAuthProfile'

export type { ToolResult, ToolHandler }

export function createToolExecutor(
  computer: ReturnType<typeof useComputer>,
  drive: ReturnType<typeof useDrive>,
) {
  const handlers: Record<string, ToolHandler> = {
    ...createComputerHandlers(computer),
    ...createDriveHandlers(drive),
    ...createCalendarHandlers(),
    ...createContactsHandlers(),
    ...createWordpressHandlers(),
    ...createUtilityHandlers(),
    ...createTrailHandlers(),
    ...createNativeHandlers(),
    ...createSheetsHandlers(),
    // P1.3 — toujours enregistré, mais le tool n'est exposé au modèle que
    // conditionnellement (cf. wantsImageGeneration dans useConversation).
    ...createImageHandlers(),
  }

  return async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    if (isPublicGoogleOAuthProfileEnabled() && isBlockedPublicGoogleTool(name)) {
      return {
        result: 'Ce profil Google public ne donne pas à Arty un accès global à Drive ou Contacts.',
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
