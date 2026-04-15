/**
 * Orchestrateur local — Phase 2
 *
 * Pilote le serveur local computer-use-server.js via le relay Cloudflare
 * (/api/computer/relay) pour créer une "application" au sens d'une nouvelle
 * instance de document : classeur Excel, document Word, bloc-notes, etc.
 *
 * Principe :
 * - Une requête de haut niveau (app + nom de fichier + contenu initial) est
 *   décomposée en une séquence de primitives computer-use (open_app, type,
 *   key, screenshot).
 * - Chaque étape passe par le proxy Cloudflare — aucune communication directe
 *   depuis le navigateur vers le PC.
 * - L'utilisateur doit avoir lancé `start-all.bat` sur sa machine et le tunnel
 *   Cloudflare doit être actif (`TUNNEL_URL` + `TUNNEL_SECRET` côté serveur).
 *
 * Sécurité :
 * - Whitelist stricte des applications (miroir du whitelist côté serveur).
 * - Validation du nom de fichier (aucun séparateur de chemin, longueur bornée).
 * - Aucune clé, aucun secret côté client — tout transite par le proxy serveur.
 */

import {
  openApp as pcOpenApp,
  screenshotPC,
  typeOnPC,
  pressKeyPC,
} from './computerClient'

export type OrchestratorAppKind =
  | 'excel'
  | 'word'
  | 'bloc-notes'
  | 'wordpress'
  | 'chrome'

export interface OrchestratorStep {
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  screenshot?: string
  error?: string
}

export interface OrchestratorRequest {
  app: OrchestratorAppKind
  filename?: string
  initialContent?: string
}

export interface OrchestratorResult {
  success: boolean
  app: string
  filename?: string
  steps: OrchestratorStep[]
  finalScreenshot?: string
  error?: string
}

export type OrchestratorProgress = (step: OrchestratorStep, index: number) => void

// Miroir du whitelist côté serveur (local/computer-use-server.js).
const ALLOWED_APPS: readonly OrchestratorAppKind[] = [
  'excel',
  'word',
  'bloc-notes',
  'wordpress',
  'chrome',
] as const

// Caractères autorisés pour un nom de fichier : lettres (y compris accents
// français), chiffres, espaces, et quelques ponctuations basiques. Pas de
// séparateur de chemin, pas de caractères spéciaux shell.
const FILENAME_REGEX = /^[\w\- .,'()àâäéèêëîïôöùûüÿçœæÀÂÄÉÈÊËÎÏÔÖÙÛÜŸÇŒÆ]+$/

function isValidFilename(name: string): boolean {
  if (!name) return false
  if (name.length > 120) return false
  return FILENAME_REGEX.test(name)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Orchestre la création d'une application sur le PC local.
 *
 * Chaque étape est un aller-retour HTTP indépendant via le proxy Cloudflare.
 * Le timeout de chaque primitive est géré côté serveur (25 s par action).
 */
export async function orchestrateCreateApp(
  req: OrchestratorRequest,
  onProgress?: OrchestratorProgress,
): Promise<OrchestratorResult> {
  const steps: OrchestratorStep[] = []
  const app = req.app

  if (!ALLOWED_APPS.includes(app)) {
    return {
      success: false,
      app,
      steps,
      error: `Application non autorisée : "${app}". Autorisées : ${ALLOWED_APPS.join(', ')}`,
    }
  }

  const filename = (req.filename ?? '').trim()
  if (filename && !isValidFilename(filename)) {
    return {
      success: false,
      app,
      steps,
      error:
        'Nom de fichier invalide. Caractères autorisés : lettres, chiffres, espaces, - _ . , \' ( )',
    }
  }

  const initialContent = req.initialContent ?? ''

  const pushStep = (label: string): OrchestratorStep => {
    const step: OrchestratorStep = { label, status: 'running' }
    steps.push(step)
    onProgress?.(step, steps.length - 1)
    return step
  }

  const markDone = (step: OrchestratorStep, screenshot?: string) => {
    step.status = 'done'
    if (screenshot) step.screenshot = screenshot
    onProgress?.(step, steps.length - 1)
  }

  const markError = (step: OrchestratorStep, error: string) => {
    step.status = 'error'
    step.error = error
    onProgress?.(step, steps.length - 1)
  }

  try {
    // 1. Ouverture de l'application
    const openStep = pushStep(`Ouverture de l'application : ${app}`)
    const openRes = await pcOpenApp(app)
    if (!openRes.success) {
      markError(openStep, openRes.error || 'Ouverture échouée')
      return { success: false, app, steps, error: openStep.error }
    }
    markDone(openStep, openRes.screenshot)

    // Laisser l'app finir de s'initialiser avant de taper.
    await sleep(800)

    // 2. Saisie du contenu initial (optionnel)
    if (initialContent) {
      const typeStep = pushStep('Saisie du contenu initial')
      const typeRes = await typeOnPC(initialContent)
      if (!typeRes.success) {
        markError(typeStep, typeRes.error || 'Saisie échouée')
      } else {
        markDone(typeStep, typeRes.screenshot)
      }
    }

    // 3. Sauvegarde sous un nom de fichier (optionnel)
    if (filename) {
      const saveStep = pushStep('Ouverture du dialogue de sauvegarde (Ctrl+S)')
      const saveRes = await pressKeyPC('ctrl+s')
      if (!saveRes.success) {
        markError(saveStep, saveRes.error || 'Raccourci Ctrl+S échoué')
      } else {
        markDone(saveStep, saveRes.screenshot)
      }

      // Laisser le dialogue apparaître.
      await sleep(1200)

      const nameStep = pushStep(`Saisie du nom de fichier : ${filename}`)
      const nameRes = await typeOnPC(filename)
      if (!nameRes.success) {
        markError(nameStep, nameRes.error || 'Saisie du nom échouée')
      } else {
        markDone(nameStep, nameRes.screenshot)
      }
    }

    // 4. Capture finale
    const finalStep = pushStep("Capture d'écran finale")
    const finalRes = await screenshotPC()
    if (!finalRes.success) {
      markError(finalStep, finalRes.error || 'Screenshot final échoué')
    } else {
      markDone(finalStep, finalRes.screenshot)
    }

    const allOk = steps.every((s) => s.status === 'done')
    return {
      success: allOk,
      app,
      filename: filename || undefined,
      steps,
      finalScreenshot: finalRes.screenshot,
      error: allOk ? undefined : steps.find((s) => s.status === 'error')?.error,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Orchestration échouée'
    return { success: false, app, steps, error: message }
  }
}

/** Pour les tests et l'UI de debug. */
export const __internal = { ALLOWED_APPS, isValidFilename }
