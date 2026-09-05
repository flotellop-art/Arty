import type { useComputer } from '../hooks/useComputer'
import type { useDrive } from '../hooks/useDrive'
import type { ToolResult, ToolHandler, ToolExecutionContext } from './tools/types'
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
import { createMailHandlers } from './tools/mailTools'
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
    // Boîtes mail IMAP natives — même principe : handlers toujours
    // enregistrés, définitions exposées seulement si ≥1 compte connecté
    // (mailToolsAvailable dans useConversation).
    ...createMailHandlers(),
  }

  return async (name: string, input: Record<string, unknown>, context?: ToolExecutionContext): Promise<ToolResult> => {
    if (isPublicGoogleOAuthProfileEnabled() && isBlockedPublicGoogleTool(name)) {
      return {
        result: 'Ce profil Google public ne donne pas à Arty un accès global à Drive ou Contacts.',
      }
    }
    const handler = handlers[name]
    if (!handler) return { result: `Outil inconnu: ${name}` }
    try {
      return await handler(input, context)
    } catch (err) {
      // Image scope failures must reach the invocation owner for teardown;
      // returning them as model text would allow the tool loop to continue.
      if (context?.imageGeneration) throw err
      return { result: `Erreur: ${err instanceof Error ? err.message : 'inconnue'}` }
    }
  }
}
