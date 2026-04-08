import type { DriveFile, DriveFileContent } from '../types/google'
import { getValidAccessToken } from './googleAuth'

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Non connecté à Google')

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

export async function listFiles(folderId?: string, query?: string): Promise<DriveFile[]> {
  const params = new URLSearchParams()
  if (folderId) params.set('folderId', folderId)
  if (query) params.set('q', query)

  const res = await authFetch(`/api/drive/files?${params}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erreur Drive')
  return data.files
}

export async function readFile(fileId: string): Promise<DriveFileContent> {
  const res = await authFetch(`/api/drive/read?id=${fileId}`)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erreur lecture fichier')
  return data
}

export async function createFile(
  name: string,
  content: string,
  options?: { mimeType?: string; folderId?: string }
): Promise<{ id: string; name: string; webViewLink: string }> {
  const res = await authFetch('/api/drive/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      content,
      mimeType: options?.mimeType,
      folderId: options?.folderId,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Erreur création fichier')
  return data
}
