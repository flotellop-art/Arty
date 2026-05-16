import type { ToolHandler } from './types'
import { listEvents, createEvent, updateEvent, deleteEvent } from '../calendarClient'
import { getDateLocale } from '../../utils/formatDate'

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
    description: 'Créer un RDV dans Google Calendar (chantier, réunion, relance client).',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: "Titre de l'événement" },
        start: { type: 'string' as const, description: 'Date/heure début (ISO 8601, ex: 2026-04-15T09:00:00)' },
        end: { type: 'string' as const, description: 'Date/heure fin (optionnel)' },
        location: { type: 'string' as const, description: 'Lieu (adresse du chantier, etc.)' },
        description: { type: 'string' as const, description: 'Notes' },
      },
      required: ['title', 'start'],
    },
  },
  {
    name: 'update_calendar_event',
    description: 'Modifier un événement du calendrier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'string' as const },
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
      properties: { event_id: { type: 'string' as const } },
      required: ['event_id'],
    },
  },
]

export function createCalendarHandlers(): Record<string, ToolHandler> {
  return {
    list_calendar: async (input) => {
      const days = (input.days as number) || 7
      try {
        const events = await listEvents(days)
        if (events.length > 0) {
          const summary = events.map((e, i) => {
            const start = new Date(e.start).toLocaleString(getDateLocale(), {
              weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })
            return `${i + 1}. ${start} — ${e.title}${e.location ? ` (${e.location})` : ''}`
          }).join('\n')
          return { result: `${events.length} événements dans les ${days} prochains jours:\n${summary}` }
        }
        return { result: `Aucun événement dans les ${days} prochains jours.` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'calendrier échoué.'}` }
      }
    },

    create_calendar_event: async (input) => {
      const { title, start, end, location, description } = input as {
        title: string; start: string; end?: string; location?: string; description?: string
      }
      try {
        const data = await createEvent({ title, start, end, location, description })
        return {
          result: `RDV "${data.title}" créé le ${new Date(data.start).toLocaleString(getDateLocale())}.${data.link ? ` Lien: ${data.link}` : ''}`,
        }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'création RDV échouée.'}` }
      }
    },

    update_calendar_event: async (input) => {
      try {
        const data = await updateEvent(input.event_id as string, {
          title: input.title as string | undefined,
          start: input.start as string | undefined,
          end: input.end as string | undefined,
          location: input.location as string | undefined,
        })
        return { result: data.success ? 'RDV modifié.' : 'Erreur: modification échouée.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'modification RDV échouée.'}` }
      }
    },

    delete_calendar_event: async (input) => {
      try {
        const data = await deleteEvent(input.event_id as string)
        return { result: data.success ? 'RDV supprimé.' : 'Erreur: suppression échouée.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'suppression RDV échouée.'}` }
      }
    },
  }
}
