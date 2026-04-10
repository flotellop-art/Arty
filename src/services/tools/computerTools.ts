import type { useComputer } from '../../hooks/useComputer'
import type { ToolHandler } from './types'

export const computerToolDefinitions = [
  {
    name: 'open_app',
    description: "Ouvre une application sur le PC de l'utilisateur (quand le PC est allumé).",
    input_schema: {
      type: 'object' as const,
      properties: {
        app: {
          type: 'string' as const,
          enum: ['excel', 'word', 'chrome', 'navigateur', 'wordpress', 'bloc-notes', 'notepad', 'calculatrice', 'paint', 'explorateur'],
        },
      },
      required: ['app'],
    },
  },
  {
    name: 'screenshot_pc',
    description: "Prend un screenshot de l'écran du PC.",
    input_schema: { type: 'object' as const, properties: {} },
  },
]

export function createComputerHandlers(computer: ReturnType<typeof useComputer>): Record<string, ToolHandler> {
  return {
    open_app: async (input) => {
      const app = (input.app as string) || ''
      const res = await computer.openApp(app)
      if (res?.success) {
        return { result: `${app} ouvert avec succès sur le PC.`, screenshot: res.screenshot }
      }
      return { result: `Erreur: ${res?.error || 'PC non joignable. Le PC est peut-être éteint.'}` }
    },

    screenshot_pc: async () => {
      const res = await computer.screenshot()
      if (res?.success) {
        return { result: 'Screenshot capturé avec succès.', screenshot: res.screenshot }
      }
      return { result: `Erreur: ${res?.error || 'PC non joignable.'}` }
    },
  }
}
