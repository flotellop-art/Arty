import type { ToolHandler } from './types'
import { callApi } from '../googleApiHelper'
import { getDateLocale } from '../../utils/formatDate'

export const wordpressToolDefinitions = [
  {
    name: 'wp_create_post',
    description: "Crée un article WordPress (brouillon ou publié). CONFIRMATION OBLIGATOIRE pour publier.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const },
        content: { type: 'string' as const, description: 'Contenu HTML' },
        status: { type: 'string' as const, enum: ['draft', 'publish', 'future'] },
        date: { type: 'string' as const, description: 'Date de publication programmée (ISO 8601)' },
      },
      required: ['title', 'content', 'status'],
    },
  },
  {
    name: 'wp_list_posts',
    description: 'Liste les articles WordPress.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string' as const, enum: ['publish', 'draft', 'any'] },
      },
    },
  },
  {
    name: 'wp_update_post',
    description: "Modifie un article WordPress existant. CONFIRMATION OBLIGATOIRE pour passer en 'publish'.",
    input_schema: {
      type: 'object' as const,
      properties: {
        post_id: { type: 'number' as const },
        title: { type: 'string' as const },
        content: { type: 'string' as const },
        status: { type: 'string' as const, enum: ['draft', 'publish'] },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'wp_delete_post',
    description: 'Supprime un article WordPress. CONFIRMATION OBLIGATOIRE.',
    input_schema: {
      type: 'object' as const,
      properties: { post_id: { type: 'number' as const } },
      required: ['post_id'],
    },
  },
]

export function createWordpressHandlers(): Record<string, ToolHandler> {
  return {
    wp_create_post: async (input) => {
      try {
        const data = await callApi('/api/wordpress/action', { type: 'create', title: input.title, content: input.content, status: input.status, date: input.date })
        return { result: data.id ? `Article "${data.title}" créé (${data.status}).${data.link ? ` Lien: ${data.link}` : ''}` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'WordPress échoué.'}` }
      }
    },

    wp_list_posts: async (input) => {
      try {
        const data = await callApi('/api/wordpress/action', { type: 'list', status: input.status })
        if (data.posts && data.posts.length > 0) {
          const list = data.posts.map((p: { id: number; title: string; status: string; date: string; link: string }, i: number) =>
            `${i + 1}. [ID:${p.id}] ${p.title} (${p.status}) — ${new Date(p.date).toLocaleDateString(getDateLocale())}`
          ).join('\n')
          return { result: `${data.posts.length} articles:\n${list}` }
        }
        return { result: 'Aucun article trouvé.' }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'WordPress échoué.'}` }
      }
    },

    wp_update_post: async (input) => {
      try {
        const data = await callApi('/api/wordpress/action', { type: 'update', postId: input.post_id, title: input.title, content: input.content, status: input.status })
        return { result: data.id ? `Article "${data.title}" modifié (${data.status}).` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'WordPress échoué.'}` }
      }
    },

    wp_delete_post: async (input) => {
      try {
        const data = await callApi('/api/wordpress/action', { type: 'delete', postId: input.post_id })
        return { result: data.success ? 'Article supprimé.' : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'WordPress échoué.'}` }
      }
    },
  }
}
