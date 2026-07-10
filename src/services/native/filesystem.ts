import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { isNative, platform } from './platform'

export interface LocalFile {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
  uri?: string
}

/** Use ExternalStorage on Android (sdcard), Documents on iOS */
function getReadDirectory(): Directory {
  return platform === 'android' ? Directory.ExternalStorage : Directory.Documents
}

/**
 * List files in a directory on the device.
 * Falls back to empty array on web.
 */
export async function listLocalFiles(path: string = ''): Promise<LocalFile[]> {
  // Android scoped storage interdit le parcours arbitraire sans SAF. Ces deux
  // opérations restent désactivées jusqu'à un picker ACTION_OPEN_DOCUMENT /
  // OPEN_DOCUMENT_TREE ; ne jamais réintroduire READ_EXTERNAL_STORAGE.
  if (!isNative || platform === 'android') return []

  try {
    const result = await Filesystem.readdir({
      path: path || '',
      directory: getReadDirectory(),
    })

    return result.files.map((f) => ({
      name: f.name,
      path: path ? `${path}/${f.name}` : f.name,
      type: f.type === 'directory' ? 'directory' : 'file',
      size: f.size,
      modifiedAt: f.mtime,
      uri: f.uri,
    }))
  } catch (err) {
    console.warn('listLocalFiles failed:', err)
    return []
  }
}

/**
 * Read a file from the device as base64.
 */
export async function readLocalFile(path: string): Promise<{ data: string; mimeType: string } | null> {
  if (!isNative || platform === 'android') return null

  try {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const mimeType = getMimeType(ext)
    const isText = mimeType.startsWith('text/') || mimeType === 'application/json'

    if (isText) {
      // Read text files with UTF-8 encoding to handle accents correctly
      const result = await Filesystem.readFile({
        path,
        directory: getReadDirectory(),
        encoding: Encoding.UTF8,
      })
      // Convert text content to base64 for consistency
      const data = typeof result.data === 'string' ? btoa(unescape(encodeURIComponent(result.data))) : ''
      return { data, mimeType }
    }

    // Read binary files (PDF, images) as base64
    const result = await Filesystem.readFile({
      path,
      directory: getReadDirectory(),
    })

    const data = typeof result.data === 'string' ? result.data : await blobToBase64(result.data as Blob)
    return { data, mimeType }
  } catch (err) {
    console.warn('readLocalFile failed:', err)
    return null
  }
}

/**
 * Write a file to the device (e.g. save a generated PDF, a report, etc.)
 */
export async function writeLocalFile(
  path: string,
  data: string,
  encoding: 'utf8' | 'base64' = 'utf8'
): Promise<string | null> {
  if (!isNative) {
    // Web fallback: trigger download
    downloadInBrowser(path, data, encoding)
    return null
  }

  try {
    const result = await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Documents,
      encoding: encoding === 'utf8' ? Encoding.UTF8 : undefined,
      recursive: true,
    })
    return result.uri
  } catch (err) {
    console.warn('writeLocalFile failed:', err)
    return null
  }
}

/**
 * Create a directory on the device.
 */
export async function createLocalDirectory(path: string): Promise<boolean> {
  if (!isNative) return false

  try {
    await Filesystem.mkdir({
      path,
      directory: Directory.Documents,
      recursive: true,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Delete a file from the device.
 */
export async function deleteLocalFile(path: string): Promise<boolean> {
  if (!isNative) return false

  try {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Documents,
    })
    return true
  } catch {
    return false
  }
}

// ─── Helpers ───

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    txt: 'text/plain',
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    json: 'application/json',
    html: 'text/html',
    xml: 'application/xml',
  }
  return map[ext] || 'application/octet-stream'
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] || result)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function downloadInBrowser(filename: string, data: string, encoding: 'utf8' | 'base64') {
  const name = filename.split('/').pop() || filename
  let blob: Blob
  if (encoding === 'base64') {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    blob = new Blob([bytes])
  } else {
    blob = new Blob([data], { type: 'text/plain;charset=utf-8' })
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
