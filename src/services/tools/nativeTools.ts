import type { ToolHandler } from './types'
import { isNative } from '../native/platform'
import { listLocalFiles, readLocalFile, writeLocalFile, deleteLocalFile } from '../native/filesystem'
import { shareContent } from '../native/share'

export function createNativeHandlers(): Record<string, ToolHandler> {
  return {
    list_local_files: async (input) => {
      if (!isNative) return { result: 'Disponible uniquement sur l\'app mobile.' }
      const path = (input.path as string) || ''
      const files = await listLocalFiles(path)
      if (files.length === 0) return { result: 'Aucun fichier trouvé.' }
      const list = files.map((f) =>
        `${f.type === 'directory' ? '📁' : '📄'} ${f.name}${f.size ? ` (${formatSize(f.size)})` : ''}`
      ).join('\n')
      return { result: `Fichiers dans ${path || 'racine'} :\n${list}` }
    },

    read_local_file: async (input) => {
      if (!isNative) return { result: 'Disponible uniquement sur l\'app mobile.' }
      const path = input.path as string
      if (!path) return { result: 'Chemin du fichier requis.' }
      const file = await readLocalFile(path)
      if (!file) return { result: `Impossible de lire le fichier : ${path}` }

      if (file.mimeType.startsWith('text/') || file.mimeType === 'application/json') {
        const text = atob(file.data)
        return { result: `Contenu de ${path} :\n${text}` }
      }

      return {
        result: `Fichier lu : ${path} (${file.mimeType})`,
        fileData: { base64: file.data, mimeType: file.mimeType, name: path.split('/').pop() || 'file' },
      }
    },

    save_local_file: async (input) => {
      const path = input.path as string
      const content = input.content as string
      const encoding = (input.encoding as 'utf8' | 'base64') || 'utf8'
      if (!path || !content) return { result: 'Chemin et contenu requis.' }

      const uri = await writeLocalFile(path, content, encoding)
      if (uri) {
        return { result: `Fichier sauvegardé : ${uri}` }
      }
      return { result: `Fichier téléchargé : ${path}` }
    },

    delete_local_file: async (input) => {
      if (!isNative) return { result: 'Disponible uniquement sur l\'app mobile.' }
      const path = input.path as string
      if (!path) return { result: 'Chemin du fichier requis.' }
      const ok = await deleteLocalFile(path)
      return { result: ok ? `Fichier supprimé : ${path}` : `Impossible de supprimer : ${path}` }
    },

    share: async (input) => {
      const title = input.title as string | undefined
      const text = input.text as string | undefined
      const url = input.url as string | undefined
      const ok = await shareContent({ title, text, url })
      return { result: ok ? 'Contenu partagé.' : 'Partage annulé.' }
    },
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const nativeToolDefinitions: any[] = isNative ? [
  {
    name: 'list_local_files',
    description: 'Liste les fichiers et dossiers sur le téléphone de l\'utilisateur. Utilise path pour naviguer dans les sous-dossiers.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin du dossier (vide = racine du stockage)' },
      },
    },
  },
  {
    name: 'read_local_file',
    description: 'Lit un fichier local du téléphone (texte, PDF, image). Retourne le contenu ou les données binaires.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin complet du fichier' },
      },
      required: ['path'],
    },
  },
  {
    name: 'save_local_file',
    description: 'Sauvegarde un fichier sur le téléphone ou propose un téléchargement sur le web.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Nom/chemin du fichier à créer' },
        content: { type: 'string', description: 'Contenu du fichier' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Encodage (défaut: utf8)' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_local_file',
    description: 'Supprime un fichier local du téléphone. Demande TOUJOURS confirmation à l\'utilisateur avant.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin du fichier à supprimer' },
      },
      required: ['path'],
    },
  },
  {
    name: 'share',
    description: 'Partage du texte, un lien ou un fichier via le menu de partage natif du téléphone.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Titre du partage' },
        text: { type: 'string', description: 'Texte à partager' },
        url: { type: 'string', description: 'URL à partager' },
      },
    },
  },
] : []
