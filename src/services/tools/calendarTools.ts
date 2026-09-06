import type { ToolHandler } from './types'
import { listEvents, prepareCalendarMutation, calendarErrorMessage, CalendarError, type CalendarContext } from '../calendarClient'
import { markUntrustedThirdPartyData } from './untrustedContent'

const EVENT_ID_DESCRIPTION =
  'Identifiant opaque fourni par list_calendar ou create_calendar_event. Le recopier exactement ; ne jamais l’inventer ni le déduire du titre ou du lien.'


export const calendarToolDefinitions = [
  {
    name: 'list_calendar',
    description: 'Voir les RDV et événements du calendrier Google (par défaut : 7 prochains jours).',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number' as const, description: 'Nombre de jours à afficher (défaut 7)' },
      },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Créer un RDV dans Google Calendar (réunion, rendez-vous, rappel).',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: "Titre de l'événement" },
        start: { type: 'string' as const, description: 'Date/heure début (ISO 8601, ex: 2026-04-15T09:00:00)' },
        end: { type: 'string' as const, description: 'Date/heure fin explicite (Europe/Paris)' },
        location: { type: 'string' as const, description: 'Lieu (adresse ou salle, etc.)' },
        description: { type: 'string' as const, description: 'Notes' },
      },
      required: ['title', 'start', 'end'],
    },
  },
  {
    name: 'update_calendar_event',
    description: 'Modifier un événement du calendrier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string' as const, description: EVENT_ID_DESCRIPTION },
        title: { type: 'string' as const },
        start: { type: 'string' as const },
        end: { type: 'string' as const },
        location: { type: 'string' as const },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Supprimer un événement du calendrier. CONFIRMATION OBLIGATOIRE.',
    input_schema: {
      type: 'object' as const,
      properties: { event_id: { type: 'string' as const, description: EVENT_ID_DESCRIPTION } },
      required: ['event_id'],
    },
  },
]

export const isCalendarMutationTool = (name: string) => ['create_calendar_event', 'update_calendar_event', 'delete_calendar_event'].includes(name)
const declined = new WeakSet<CalendarContext>()

export function createCalendarHandlers(): Record<string, ToolHandler> {
  const mutate = (operation: 'create' | 'update' | 'delete'): ToolHandler => async (input, context) => {
    const scope = context?.calendar?.scope ?? null
    try {
      if (!scope || context?.calendar?.signal?.aborted) return { result: 'Agenda non autorisé pour ce parcours. Aucun envoi.' }
      if (declined.has(scope)) return { result: "Action déjà refusée. Ne la relance pas sans un nouveau tour explicite de l'utilisateur." }
      const prepared = prepareCalendarMutation(scope, operation, input, input.event_id as string)
      // Native browser dialog is application UI. The model supplies no consent.
      if (!window.confirm(prepared.review)) {
        declined.add(scope)
        return { result: "L'utilisateur a refusé cette action. Ne la relance pas sans son accord explicite." }
      }
      const data = await prepared.execute(context?.calendar?.signal)
      try { scope.assertCurrent() } catch { throw new CalendarError('unknown') }
      return { result: markUntrustedThirdPartyData('Google Agenda', `Action ${operation} confirmée (JSON):\n${JSON.stringify(data)}`) }
    } catch (error) {
      return { result: calendarErrorMessage(error) }
    }
  }
  return {
    list_calendar: async (input, context) => {
      try {
        const days = input.days === undefined ? 7 : input.days as number
        const events = await listEvents(days, context?.calendar?.scope ?? null, context?.calendar?.signal)
        context!.calendar!.scope!.assertCurrent()
        return { result: markUntrustedThirdPartyData('Google Agenda',
          `Liste limitée à 20 événements, pas une preuve d'absence de conflit ; période ${days} jours (JSON):\n${JSON.stringify(events.map(e => ({
            event_id: e.id, start: e.start, end: e.end, title: e.title, location: e.location,
          })))}`) }
      } catch (error) { return { result: calendarErrorMessage(error) } }
    },
    create_calendar_event: mutate('create'),
    update_calendar_event: mutate('update'),
    delete_calendar_event: mutate('delete'),
  }
}
