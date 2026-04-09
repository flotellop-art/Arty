import type { DriveFile, DriveFileContent } from '../types/google'
import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'

async function driveFetch(body: Record<string, unknown>): Promise<Response> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Non connecté à Google')

  return fetch('/api/drive/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

export async function listFiles(folderId?: string, query?: string): Promise<DriveFile[]> {
  const res = await driveFetch({ type: 'list', folderId, q: query })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur Drive')
  return data.files
}

export async function readFile(fileId: string): Promise<DriveFileContent> {
  const res = await driveFetch({ type: 'read', id: fileId })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur lecture fichier')
  return data
}

export async function createFile(
  name: string,
  content: string,
  options?: { mimeType?: string; folderId?: string }
): Promise<{ id: string; name: string; webViewLink: string }> {
  const res = await driveFetch({ type: 'create', name, content, ...options })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data.error || 'Erreur création fichier')
  return data
}
