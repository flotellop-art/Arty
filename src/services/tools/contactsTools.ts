import type { ToolHandler } from './types'
import { searchContacts, createContact } from '../contactsClient'

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
        const contacts = await searchContacts(input.query as string)
        if (contacts.length > 0) {
          const list = contacts.map((c, i) =>
            `${i + 1}. ${c.name}${c.phone ? ` — ${c.phone}` : ''}${c.email ? ` — ${c.email}` : ''}${c.company ? ` (${c.company})` : ''}`
          ).join('\n')
          return { result: `${contacts.length} contacts:\n${list}` }
        }
        return { result: 'Aucun contact trouvé.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'contacts échoué.'}` }
      }
    },

    create_contact: async (input) => {
      const { name, email, phone, company } = input as {
        name: string; email?: string; phone?: string; company?: string
      }
      try {
        const data = await createContact({ name, email, phone, company })
        return { result: data.success ? `Contact "${name}" ajouté.` : 'Erreur: création échouée.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'création contact échouée.'}` }
      }
    },
  }
}
