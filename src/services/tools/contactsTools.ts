import type { ToolHandler } from './types'
import { callGoogleApi } from '../googleApiHelper'

export const contactsToolDefinitions = [
  {
    name: 'search_contacts',
    description: 'Chercher un contact client par nom.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string' as const } },
      required: ['query'],
    },
  },
  {
    name: 'create_contact',
    description: 'Ajouter un nouveau contact client.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        email: { type: 'string' as const },
        phone: { type: 'string' as const },
        company: { type: 'string' as const },
      },
      required: ['name'],
    },
  },
]

export function createContactsHandlers(): Record<string, ToolHandler> {
  return {
    search_contacts: async (input) => {
      try {
        const data = await callGoogleApi('/api/contacts/action', { type: 'search', query: input.query })
        if (data.contacts && data.contacts.length > 0) {
          const list = data.contacts.map((c: { name: string; email: string; phone: string; company: string }, i: number) =>
            `${i + 1}. ${c.name}${c.phone ? ` — ${c.phone}` : ''}${c.email ? ` — ${c.email}` : ''}${c.company ? ` (${c.company})` : ''}`
          ).join('\n')
          return { result: `${data.contacts.length} contacts:\n${list}` }
        }
        return { result: 'Aucun contact trouvé.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'contacts échoué.'}` }
      }
    },

    create_contact: async (input) => {
      try {
        const data = await callGoogleApi('/api/contacts/action', { type: 'create', ...input })
        return { result: data.success ? `Contact "${input.name}" ajouté.` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'création contact échouée.'}` }
      }
    },
  }
}
