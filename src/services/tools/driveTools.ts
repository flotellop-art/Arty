import type { useDrive } from '../../hooks/useDrive'
import type { ToolHandler } from './types'
import { callGoogleApi } from '../googleApiHelper'

export const driveToolDefinitions = [
  {
    name: 'list_drive',
    description: 'Liste les fichiers sur Google Drive. Sans folder_id: liste la racine. Avec folder_id: liste le contenu du dossier. Pour trouver un fichier, explore les dossiers un par un.',
    input_schema: {
      type: 'object' as const,
      properties: {
        folder_id: { type: 'string' as const, description: 'ID du dossier à lister (optionnel — sans = racine)' },
      },
    },
  },
  {
    name: 'search_drive',
    description: 'Cherche un fichier par nom sur Google Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Nom ou mot-clé à chercher' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_drive_file',
    description: "Lit le contenu d'un fichier Drive (PDF, Doc, texte, tableur).",
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const, description: 'ID du fichier' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'create_drive_file',
    description: 'Crée un nouveau document sur Google Drive (Google Doc).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Nom du fichier' },
        content: { type: 'string' as const, description: 'Contenu du document' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'delete_drive_file',
    description: 'Supprime un fichier de Google Drive. CONFIRMATION OBLIGATOIRE.',
    input_schema: {
      type: 'object' as const,
      properties: { file_id: { type: 'string' as const } },
      required: ['file_id'],
    },
  },
  {
    name: 'rename_drive_file',
    description: 'Renomme un fichier sur Google Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        new_name: { type: 'string' as const },
      },
      required: ['file_id', 'new_name'],
    },
  },
  {
    name: 'move_drive_file',
    description: 'Déplace un fichier dans un dossier Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        folder_id: { type: 'string' as const, description: 'ID du dossier destination' },
      },
      required: ['file_id', 'folder_id'],
    },
  },
  {
    name: 'create_drive_folder',
    description: 'Crée un dossier sur Google Drive (pour organiser par client/chantier).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        parent_id: { type: 'string' as const, description: 'ID du dossier parent (optionnel)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'share_drive_file',
    description: 'Partage un fichier Drive avec une adresse email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        email: { type: 'string' as const },
        role: { type: 'string' as const, enum: ['reader', 'writer', 'commenter'] },
      },
      required: ['file_id', 'email'],
    },
  },
  {
    name: 'copy_drive_file',
    description: 'Copie un fichier Drive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id: { type: 'string' as const },
        new_name: { type: 'string' as const },
      },
      required: ['file_id'],
    },
  },
]

export function createDriveHandlers(drive: ReturnType<typeof useDrive>): Record<string, ToolHandler> {
  return {
    list_drive: async (input) => {
      try {
        const folderId = input.folder_id as string | undefined
        const data = await callGoogleApi('/api/drive/action', { type: 'list', folderId })
        if (data.error) return { result: `Erreur Drive: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}` }
        const files = data.files || []
        if (files.length > 0) {
          const summary = files.slice(0, 50).map((f: { id: string; name: string; mimeType: string }, i: number) =>
            `${i + 1}. [ID:${f.id}] ${f.name} (${f.mimeType.split('.').pop() || f.mimeType})`
          ).join('\n')
          return { result: `${files.length} fichiers${folderId ? ' dans ce dossier' : ''}:\n${summary}` }
        }
        return { result: folderId ? 'Dossier vide.' : `Aucun fichier sur Drive. (debug: ${JSON.stringify(data.debug || {})})` }
      } catch (err) {
        return { result: `Erreur Drive: ${err instanceof Error ? err.message : 'inconnu'}` }
      }
    },

    search_drive: async (input) => {
      const query = input.query as string
      if (!query) return { result: 'Erreur: requête manquante.' }
      try {
        const files = await drive.fetchFiles(undefined, query)
        if (files && files.length > 0) {
          const summary = files.map((f, i) =>
            `${i + 1}. [ID:${f.id}] ${f.name} (${f.mimeType.split('.').pop() || f.mimeType})`
          ).join('\n')
          return { result: `${files.length} fichiers trouvés pour "${query}":\n${summary}` }
        }
        return { result: `Aucun fichier trouvé pour "${query}". Essaie avec d'autres mots-clés ou liste le contenu des dossiers avec list_drive.` }
      } catch (err) {
        return { result: `Erreur recherche Drive: ${err instanceof Error ? err.message : 'Google non connecté ?'}` }
      }
    },

    read_drive_file: async (input) => {
      const fileId = input.file_id as string
      if (!fileId) return { result: 'Erreur: ID fichier manquant.' }
      try {
        const data = await callGoogleApi('/api/drive/action', { type: 'read', id: fileId })
        if (data.error) return { result: `Erreur lecture: ${data.error}` }
        return { result: `Fichier: ${data.name}\nType: ${data.mimeType}\n\nContenu:\n${data.content}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'lecture échouée'}` }
      }
    },

    create_drive_file: async (input) => {
      const fileName = input.name as string
      const content = input.content as string
      if (!fileName || !content) return { result: 'Erreur: nom ou contenu manquant.' }
      const res = await drive.createFile(fileName, content)
      if (res) {
        return { result: `Document "${res.name}" créé sur Drive.${res.webViewLink ? ` Lien: ${res.webViewLink}` : ''}` }
      }
      return { result: 'Erreur: création échouée.' }
    },

    delete_drive_file: async (input) => {
      try {
        const data = await callGoogleApi('/api/drive/action', { type: 'delete', id: input.file_id })
        return { result: data.success ? 'Fichier supprimé.' : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'suppression échouée.'}` }
      }
    },

    rename_drive_file: async (input) => {
      try {
        const data = await callGoogleApi('/api/drive/action', { type: 'rename', id: input.file_id, name: input.new_name })
        return { result: data.success ? `Fichier renommé en "${data.name}".` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'renommage échoué.'}` }
      }
    },

    move_drive_file: async (input) => {
      try {
        const data = await callGoogleApi('/api/drive/action', { type: 'move', id: input.file_id, folderId: input.folder_id })
        return { result: data.success ? 'Fichier déplacé.' : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'déplacement échoué.'}` }
      }
    },

    create_drive_folder: async (input) => {
      try {
        const data = await callGoogleApi('/api/drive/action', { type: 'create_folder', name: input.name, parentId: input.parent_id })
        return { result: data.id ? `Dossier "${data.name}" créé.${data.webViewLink ? ` Lien: ${data.webViewLink}` : ''}` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'création dossier échouée.'}` }
      }
    },

    share_drive_file: async (input) => {
      try {
        const data = await callGoogleApi('/api/drive/action', { type: 'share', id: input.file_id, email: input.email, role: input.role })
        return { result: data.success ? `Fichier partagé avec ${data.shared_with}.` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'partage échoué.'}` }
      }
    },

    copy_drive_file: async (input) => {
      try {
        const data = await callGoogleApi('/api/drive/action', { type: 'copy', id: input.file_id, name: input.new_name })
        return { result: data.id ? `Fichier copié: "${data.name}".` : `Erreur: ${data.error}` }
      } catch (err) {
        return { result: `Erreur: ${err instanceof Error ? err.message : 'copie échouée.'}` }
      }
    },
  }
}
