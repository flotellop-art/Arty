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

export interface DestructiveToolConfirmationRequest {
  name: string
  input: Record<string, unknown>
  message: string
}

export type DestructiveToolConfirm = (
  request: DestructiveToolConfirmationRequest
) => boolean | Promise<boolean>

export interface ToolExecutorOptions {
  confirmDestructiveTool?: DestructiveToolConfirm
}

const ALWAYS_CONFIRM_TOOL_NAMES = new Set([
  // Gmail: external messages / mailbox state changes.
  'send_email',
  'reply_email',
  'create_draft_email',
  'archive_email',
  'delete_email',
  'star_email',
  'label_email',

  // Google Calendar: external state changes visible to the user/attendees.
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',

  // Google Contacts / Drive / Sheets: persistent external account writes.
  'create_contact',
  'create_drive_file',
  'delete_drive_file',
  'create_drive_folder',
  'export_clients_to_sheets',
  'export_projets_to_sheets',

  // WordPress: existing/public content changes.
  'wp_update_post',
  'wp_delete_post',

  // Local device/PC or persistent user state that prompt injection could alter.
  'update_memory',
  'save_local_file',
  'delete_local_file',
  'create_app',
])

function normalizeStatus(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function requiresDestructiveToolConfirmation(
  name: string,
  input: Record<string, unknown> = {}
): boolean {
  if (ALWAYS_CONFIRM_TOOL_NAMES.has(name)) return true

  if (name === 'wp_create_post' || name === 'publish_wordpress') {
    // Draft creation is an intended low-risk workflow. Anything not explicitly
    // a draft (publish, future/scheduled, or malformed/missing status) requires
    // an explicit human click before it can leave the app as public content.
    return normalizeStatus(input.status) !== 'draft'
  }

  return false
}

function compact(value: unknown, fallback = 'non précisé'): string {
  if (typeof value === 'string') {
    const clean = value.replace(/\s+/g, ' ').trim()
    if (!clean) return fallback
    return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value == null) return fallback
  try {
    const json = JSON.stringify(value)
    return json.length > 120 ? `${json.slice(0, 117)}…` : json
  } catch {
    return fallback
  }
}

function compactJson(input: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(input)
    return json.length > 220 ? `${json.slice(0, 217)}…` : json
  } catch {
    return '[paramètres illisibles]'
  }
}

export function buildToolConfirmMessage(name: string, input: Record<string, unknown> = {}): string {
  let action: string

  switch (name) {
    case 'send_email':
      action = `Envoyer un email à ${compact(input.to)} — sujet : ${compact(input.subject)}`
      break
    case 'reply_email':
      action = `Répondre à ${compact(input.to)} dans le thread ${compact(input.thread_id)} — sujet : ${compact(input.subject)}`
      break
    case 'create_draft_email':
      action = `Créer un brouillon Gmail pour ${compact(input.to)} — sujet : ${compact(input.subject)}`
      break
    case 'archive_email':
      action = `Archiver l'email ${compact(input.message_id)}`
      break
    case 'delete_email':
      action = `Supprimer l'email ${compact(input.message_id)}`
      break
    case 'star_email':
      action = `Marquer l'email ${compact(input.message_id)} comme important/étoilé`
      break
    case 'label_email':
      action = `Appliquer le label « ${compact(input.label)} » à l'email ${compact(input.message_id)}`
      break
    case 'create_calendar_event':
      action = `Créer l'événement calendrier « ${compact(input.title)} » le ${compact(input.start)}`
      break
    case 'update_calendar_event':
      action = `Modifier l'événement calendrier ${compact(input.event_id)}`
      break
    case 'delete_calendar_event':
      action = `Supprimer l'événement calendrier ${compact(input.event_id)}`
      break
    case 'create_contact':
      action = `Créer le contact Google « ${compact(input.name)} » (${compact(input.email, 'email absent')})`
      break
    case 'create_drive_file':
      action = `Créer le fichier Google Drive « ${compact(input.name)} »`
      break
    case 'delete_drive_file':
      action = `Supprimer le fichier Google Drive ${compact(input.file_id)}`
      break
    case 'create_drive_folder':
      action = `Créer le dossier Google Drive « ${compact(input.name)} »`
      break
    case 'export_clients_to_sheets':
      action = `Exporter la mémoire clients vers Google Sheets « ${compact(input.title, 'Clients Arty')} »`
      break
    case 'export_projets_to_sheets':
      action = `Exporter la mémoire projets vers Google Sheets « ${compact(input.title, 'Projets Arty')} »`
      break
    case 'wp_create_post':
      action = `Créer un article WordPress avec le statut « ${compact(input.status)} » — titre : ${compact(input.title)}`
      break
    case 'publish_wordpress':
      action = `Publier via WordPress avec le statut « ${compact(input.status)} » — titre : ${compact(input.title)}`
      break
    case 'wp_update_post':
      action = `Modifier l'article WordPress ${compact(input.post_id)} — titre : ${compact(input.title, 'inchangé')}`
      break
    case 'wp_delete_post':
      action = `Supprimer l'article WordPress ${compact(input.post_id)}`
      break
    case 'update_memory':
      action = `Modifier la mémoire persistante (${compact(input.category)})`
      break
    case 'save_local_file':
      action = `Écrire le fichier local ${compact(input.path)}`
      break
    case 'delete_local_file':
      action = `Supprimer le fichier local ${compact(input.path)}`
      break
    case 'create_app':
      action = `Créer un document/fichier sur le PC via ${compact(input.app)} — fichier : ${compact(input.filename, 'nom non précisé')}`
      break
    default:
      action = `Exécuter l'outil ${name} avec paramètres ${compactJson(input)}`
  }

  return [
    'Confirmation requise avant action sensible.',
    action,
    'Confirme uniquement si cette action correspond exactement à ta demande.'
  ].join('\n')
}

async function defaultConfirmDestructiveTool(
  request: DestructiveToolConfirmationRequest
): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(request.message)
    }
  } catch {
    // jsdom/non-interactive shells can expose confirm() but throw when called.
  }
  return false
}

export function createToolExecutor(
  computer: ReturnType<typeof useComputer>,
  gmail: ReturnType<typeof useGmail>,
  drive: ReturnType<typeof useDrive>,
  browserActions: ReturnType<typeof useBrowser>,
  options: ToolExecutorOptions = {},
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

  const confirmDestructiveTool = options.confirmDestructiveTool ?? defaultConfirmDestructiveTool

  return async (name: string, input: Record<string, unknown>): Promise<ToolResult> => {
    const handler = handlers[name]
    if (!handler) return { result: `Outil inconnu: ${name}` }

    if (requiresDestructiveToolConfirmation(name, input)) {
      const request: DestructiveToolConfirmationRequest = {
        name,
        input,
        message: buildToolConfirmMessage(name, input),
      }

      let confirmed = false
      try {
        confirmed = await confirmDestructiveTool(request)
      } catch {
        confirmed = false
      }

      if (!confirmed) {
        return { result: `Action annulée : confirmation utilisateur requise pour ${name}.` }
      }
    }

    try {
      return await handler(input)
    } catch (err) {
      return { result: `Erreur: ${err instanceof Error ? err.message : 'inconnue'}` }
    }
  }
}
