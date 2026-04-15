import type { useComputer } from '../../hooks/useComputer'
import type { ToolHandler } from './types'
import { orchestrateCreateApp, type OrchestratorAppKind } from '../orchestrator'

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
  {
    name: 'create_app',
    description:
      "Orchestrateur local (Phase 2) — crée une nouvelle instance d'application sur le PC : " +
      "ouvre l'app, saisit éventuellement un contenu initial, puis sauvegarde sous un nom de " +
      "fichier. Utilise cet outil quand l'utilisateur demande de créer un nouveau document, " +
      "classeur, ou fichier (ex : « crée un classeur Excel pour le suivi chantiers »). " +
      "Le PC doit être joignable (start-all.bat lancé + tunnel actif).",
    input_schema: {
      type: 'object' as const,
      properties: {
        app: {
          type: 'string' as const,
          enum: ['excel', 'word', 'bloc-notes', 'wordpress', 'chrome'],
          description: "Application cible (miroir du whitelist de l'Orchestrateur).",
        },
        filename: {
          type: 'string' as const,
          description:
            "Nom de fichier pour la sauvegarde (optionnel). Caractères autorisés : lettres, " +
            "chiffres, espaces, - _ . , ' ( ). Max 120 caractères. Pas de séparateur de chemin.",
        },
        initialContent: {
          type: 'string' as const,
          description:
            "Contenu initial à saisir dans l'application une fois ouverte (optionnel). " +
            "Pour Excel, utilise des tabulations et retours ligne pour remplir les cellules.",
        },
      },
      required: ['app'],
    },
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

    create_app: async (input) => {
      const app = (input.app as OrchestratorAppKind) || ('excel' as OrchestratorAppKind)
      const filename = typeof input.filename === 'string' ? input.filename : undefined
      const initialContent = typeof input.initialContent === 'string' ? input.initialContent : undefined

      const result = await orchestrateCreateApp({ app, filename, initialContent })

      if (result.success) {
        const summary = [
          `Application "${result.app}" créée via l'Orchestrateur local.`,
          result.filename ? `Fichier : ${result.filename}` : null,
          `${result.steps.length} étape(s) : ${result.steps.map((s) => s.label).join(' → ')}`,
        ]
          .filter(Boolean)
          .join('\n')
        return { result: summary, screenshot: result.finalScreenshot }
      }

      const failedStep = result.steps.find((s) => s.status === 'error')
      const detail = failedStep
        ? `Échec à l'étape "${failedStep.label}" — ${failedStep.error || 'raison inconnue'}.`
        : result.error || 'PC non joignable ou Orchestrateur indisponible.'
      return { result: `Erreur Orchestrateur : ${detail}`, screenshot: result.finalScreenshot }
    },
  }
}
