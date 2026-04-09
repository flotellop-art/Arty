import * as drive from './driveClient'

const MEMORY_FOLDER_NAME = 'IA-Memoire'
const MEMORY_FILES = {
  profil: 'profil.json',
  clients: 'clients.json',
  chantiers: 'chantiers.json',
  notes: 'notes.json',
} as const

type MemoryCategory = keyof typeof MEMORY_FILES

export interface MemoryData {
  profil: Record<string, unknown>
  clients: Record<string, unknown>[]
  chantiers: Record<string, unknown>[]
  notes: string[]
}

// Cache folder/file IDs to avoid repeated lookups
let folderIdCache: string | null = null
const fileIdCache: Partial<Record<MemoryCategory, string>> = {}

async function findOrCreateFolder(): Promise<string> {
  if (folderIdCache) return folderIdCache

  // Search for existing folder
  const files = await drive.listFiles(undefined, MEMORY_FOLDER_NAME)
  const folder = files.find(
    (f) => f.name === MEMORY_FOLDER_NAME && f.mimeType === 'application/vnd.google-apps.folder'
  )

  if (folder) {
    folderIdCache = folder.id
    return folder.id
  }

  // Create folder via Drive API
  const { getValidAccessToken } = await import('./googleAuth')
  const token = await getValidAccessToken()
  if (!token) throw new Error('Google non connecté')

  const r = await fetch('/api/drive/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'create_folder', name: MEMORY_FOLDER_NAME }),
  })
  const data = await r.json()
  folderIdCache = data.id
  return data.id
}

async function findMemoryFile(category: MemoryCategory): Promise<string | null> {
  if (fileIdCache[category]) return fileIdCache[category]!

  const folderId = await findOrCreateFolder()
  const files = await drive.listFiles(folderId)
  const file = files.find((f) => f.name === MEMORY_FILES[category])

  if (file) {
    fileIdCache[category] = file.id
    return file.id
  }
  return null
}

function getDefaultData(category: MemoryCategory): unknown {
  switch (category) {
    case 'profil':
      return {
        preferences: {},
        habitudes: {},
        fournisseurs: {},
        derniereMAJ: new Date().toISOString(),
      }
    case 'clients':
      return []
    case 'chantiers':
      return []
    case 'notes':
      return []
  }
}

export async function readMemory(category: MemoryCategory): Promise<unknown> {
  try {
    const fileId = await findMemoryFile(category)
    if (!fileId) return getDefaultData(category)

    const file = await drive.readFile(fileId)
    return JSON.parse(file.content)
  } catch {
    return getDefaultData(category)
  }
}

export async function readAllMemory(): Promise<MemoryData> {
  const [profil, clients, chantiers, notes] = await Promise.all([
    readMemory('profil'),
    readMemory('clients'),
    readMemory('chantiers'),
    readMemory('notes'),
  ])

  return {
    profil: profil as Record<string, unknown>,
    clients: clients as Record<string, unknown>[],
    chantiers: chantiers as Record<string, unknown>[],
    notes: notes as string[],
  }
}

export async function updateMemory(
  category: MemoryCategory,
  data: unknown
): Promise<{ success: boolean; message: string }> {
  try {
    const folderId = await findOrCreateFolder()
    const content = JSON.stringify(data, null, 2)
    const fileName = MEMORY_FILES[category]

    const fileId = await findMemoryFile(category)

    if (fileId) {
      // Update existing file — use Drive API update
      const { getValidAccessToken } = await import('./googleAuth')
      const token = await getValidAccessToken()
      if (!token) return { success: false, message: 'Google non connecté' }

      const res = await fetch('/api/drive/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ type: 'update', id: fileId, content }),
      })

      if (!res.ok) {
        // Fallback: delete and recreate
        await fetch('/api/drive/action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ type: 'delete', id: fileId }),
        })
        const newFile = await drive.createFile(fileName, content, { folderId })
        fileIdCache[category] = newFile.id
      }
    } else {
      // Create new file
      const newFile = await drive.createFile(fileName, content, { folderId })
      fileIdCache[category] = newFile.id
    }

    return { success: true, message: `Mémoire "${category}" mise à jour.` }
  } catch (err) {
    return {
      success: false,
      message: `Erreur mise à jour mémoire: ${err instanceof Error ? err.message : 'inconnu'}`,
    }
  }
}

export function formatMemoryForPrompt(memory: MemoryData): string {
  const parts: string[] = []

  // Profil
  if (memory.profil && Object.keys(memory.profil).length > 0) {
    parts.push(`PROFIL UTILISATEUR :\n${JSON.stringify(memory.profil, null, 2)}`)
  }

  // Clients
  if (memory.clients && memory.clients.length > 0) {
    const clientSummary = memory.clients
      .slice(0, 20)
      .map((c) => `- ${c.nom || 'Inconnu'}: ${c.resume || JSON.stringify(c)}`)
      .join('\n')
    parts.push(`CLIENTS CONNUS (${memory.clients.length}) :\n${clientSummary}`)
  }

  // Chantiers
  if (memory.chantiers && memory.chantiers.length > 0) {
    const chantierSummary = memory.chantiers
      .slice(0, 20)
      .map((ch) => `- ${ch.adresse || ch.nom || 'Inconnu'}: ${ch.resume || JSON.stringify(ch)}`)
      .join('\n')
    parts.push(`CHANTIERS (${memory.chantiers.length}) :\n${chantierSummary}`)
  }

  // Notes
  if (memory.notes && memory.notes.length > 0) {
    parts.push(`NOTES :\n${memory.notes.slice(-10).map((n) => `- ${n}`).join('\n')}`)
  }

  if (parts.length === 0) return ''
  return `\n\nMÉMOIRE PERSISTANTE (stockée sur Drive, mise à jour auto) :\n${parts.join('\n\n')}`
}
