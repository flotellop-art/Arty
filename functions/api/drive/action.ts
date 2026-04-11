import type { Env } from '../../env'

const ID_RE = /^[a-zA-Z0-9_-]+$/

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Missing token' }, { status: 401 })

  const body = await request.json() as Record<string, unknown>
  const type = body.type as string | undefined

  switch (type) {
    case 'list':          return handleList(token, body)
    case 'read':          return handleRead(token, body)
    case 'download':      return handleDownload(token, body)
    case 'create':        return handleCreate(token, body)
    case 'update':        return handleUpdate(token, body)
    case 'delete':        return handleDelete(token, body)
    case 'rename':        return handleRename(token, body)
    case 'move':          return handleMove(token, body)
    case 'create_folder': return handleCreateFolder(token, body)
    case 'share':         return handleShare(token, body)
    case 'copy':          return handleCopy(token, body)
    default:
      return Response.json({ error: 'Use type: list, read, download, create, update, delete, rename, move, create_folder, share, copy' }, { status: 400 })
  }
}

async function handleList(token: string, body: Record<string, unknown>): Promise<Response> {
  const folderId = body.folderId as string | undefined
  const query = body.q as string | undefined

  // Validate folderId to prevent Drive query injection
  if (folderId && !ID_RE.test(folderId)) {
    return Response.json({ error: 'Invalid folder ID' }, { status: 400 })
  }

  try {
    let q = 'trashed=false'
    if (folderId) q += ` and '${folderId}' in parents`
    if (query) {
      // Sanitize: keep only alphanumeric, spaces, accents, hyphens, dots
      const sanitized = query.replace(/[^a-zA-Z0-9\s\u00C0-\u017F.\-]/g, '')
      if (sanitized) {
        q += ` and (fullText contains '${sanitized}')`
      }
    }
    const params = new URLSearchParams({ q, fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)', orderBy: 'modifiedTime desc', pageSize: '200' })
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) {
      return Response.json({ error: 'Drive API error' }, { status: r.status })
    }
    const data = await r.json() as { files?: unknown[] }
    return Response.json({ files: data.files || [] })
  } catch { return Response.json({ error: 'Failed to list files' }, { status: 500 }) }
}

async function handleRead(token: string, body: Record<string, unknown>): Promise<Response> {
  const fileId = body.id as string
  if (!fileId) return Response.json({ error: 'Missing id' }, { status: 400 })
  if (!ID_RE.test(fileId)) return Response.json({ error: 'Invalid file ID' }, { status: 400 })
  try {
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,modifiedTime`, { headers: { Authorization: `Bearer ${token}` } })
    if (!metaRes.ok) { const err = await metaRes.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: metaRes.status }) }
    const meta = await metaRes.json() as { id: string; name: string; mimeType: string; modifiedTime: string }
    let content = ''
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) content = await r.text()
    } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) content = await r.text()
    } else if (meta.mimeType?.startsWith('text/')) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) content = await r.text()
    } else if (meta.mimeType === 'application/pdf') {
      // Try Google Drive export first (works for Google Docs saved as PDF)
      const expRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${token}` } })
      if (expRes.ok) {
        content = await expRes.text()
      } else {
        // Native PDF — return raw base64 for frontend to handle via Claude's native PDF support
        const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
        if (dlRes.ok) {
          const arrayBuf = await dlRes.arrayBuffer()
          const bytes = new Uint8Array(arrayBuf)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          const base64 = btoa(binary)
          return Response.json({
            id: meta.id, name: meta.name, mimeType: meta.mimeType, modifiedTime: meta.modifiedTime,
            content: '', base64Pdf: base64,
          })
        }
      }
    } else {
      content = `[Fichier binaire : ${meta.name} (${meta.mimeType})]`
    }
    return Response.json({ id: meta.id, name: meta.name, mimeType: meta.mimeType, modifiedTime: meta.modifiedTime, content: content.slice(0, 10000) })
  } catch { return Response.json({ error: 'Failed to read file' }, { status: 500 }) }
}

async function handleDownload(token: string, body: Record<string, unknown>): Promise<Response> {
  const fileId = body.id as string
  if (!fileId) return Response.json({ error: 'Missing id' }, { status: 400 })
  if (!ID_RE.test(fileId)) return Response.json({ error: 'Invalid file ID' }, { status: 400 })
  try {
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`, { headers: { Authorization: `Bearer ${token}` } })
    if (!metaRes.ok) { const err = await metaRes.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: metaRes.status }) }
    const meta = await metaRes.json() as { id: string; name: string; mimeType: string }

    let dlUrl: string
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      dlUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`
    } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      dlUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`
    } else {
      dlUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    }

    const dlRes = await fetch(dlUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!dlRes.ok) return Response.json({ error: 'Download failed' }, { status: dlRes.status })

    const arrayBuf = await dlRes.arrayBuffer()
    const bytes = new Uint8Array(arrayBuf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)
    const mimeType = meta.mimeType?.startsWith('application/vnd.google-apps.') ? 'application/pdf' : meta.mimeType

    return Response.json({ id: meta.id, name: meta.name, mimeType, base64, size: arrayBuf.byteLength })
  } catch { return Response.json({ error: 'Download failed' }, { status: 500 }) }
}

async function handleCreate(token: string, body: Record<string, unknown>): Promise<Response> {
  const { name, content, mimeType, folderId } = body as { name?: string; content?: string; mimeType?: string; folderId?: string }
  if (!name || !content) return Response.json({ error: 'Missing name or content' }, { status: 400 })
  try {
    const isGoogleDoc = !mimeType || mimeType === 'application/vnd.google-apps.document'
    const metadata: { name: string; mimeType?: string; parents?: string[] } = { name }
    if (isGoogleDoc) metadata.mimeType = 'application/vnd.google-apps.document'
    if (folderId) metadata.parents = [folderId]
    const boundary = 'fp_boundary'
    const reqBody = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${isGoogleDoc ? 'text/plain' : mimeType || 'text/plain'}\r\n\r\n${content}\r\n--${boundary}--`
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: reqBody,
    })
    if (!r.ok) { const err = await r.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: r.status }) }
    const result = await r.json() as { id: string; name: string; webViewLink: string }
    return Response.json({ id: result.id, name: result.name, webViewLink: result.webViewLink })
  } catch { return Response.json({ error: 'Failed to create file' }, { status: 500 }) }
}

async function handleUpdate(token: string, body: Record<string, unknown>): Promise<Response> {
  const { id, content } = body as { id?: string; content?: string }
  if (!id || content === undefined) return Response.json({ error: 'Missing id or content' }, { status: 400 })
  try {
    // Check if it's a Google Doc (need special handling)
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const meta = await metaRes.json() as { mimeType: string }
    const isGoogleDoc = meta.mimeType === 'application/vnd.google-apps.document'

    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': isGoogleDoc ? 'text/plain' : 'application/json',
      },
      body: content,
    })
    if (!r.ok) { const err = await r.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Update failed' }, { status: 500 }) }
}

async function handleDelete(token: string, body: Record<string, unknown>): Promise<Response> {
  const fileId = body.id as string
  if (!fileId) return Response.json({ error: 'Missing id' }, { status: 400 })
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok && r.status !== 204) { const err = await r.json().catch(() => ({})) as { error?: { message?: string } }; return Response.json({ error: 'Delete failed' }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Delete failed' }, { status: 500 }) }
}

async function handleRename(token: string, body: Record<string, unknown>): Promise<Response> {
  const { id, name } = body as { id?: string; name?: string }
  if (!id || !name) return Response.json({ error: 'Missing id or name' }, { status: 400 })
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!r.ok) { const err = await r.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: r.status }) }
    return Response.json({ success: true, name })
  } catch { return Response.json({ error: 'Rename failed' }, { status: 500 }) }
}

async function handleMove(token: string, body: Record<string, unknown>): Promise<Response> {
  const { id, folderId } = body as { id?: string; folderId?: string }
  if (!id || !folderId) return Response.json({ error: 'Missing id or folderId' }, { status: 400 })
  try {
    // Get current parents
    const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=parents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const current = await getRes.json() as { parents?: string[] }
    const previousParents = (current.parents || []).join(',')

    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?addParents=${folderId}&removeParents=${previousParents}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) { const err = await r.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Move failed' }, { status: 500 }) }
}

async function handleCreateFolder(token: string, body: Record<string, unknown>): Promise<Response> {
  const { name, parentId } = body as { name?: string; parentId?: string }
  if (!name) return Response.json({ error: 'Missing name' }, { status: 400 })
  try {
    const metadata: { name: string; mimeType: string; parents?: string[] } = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    }
    if (parentId) metadata.parents = [parentId]

    const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    })
    if (!r.ok) { const err = await r.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: r.status }) }
    const result = await r.json() as { id: string; name: string; webViewLink: string }
    return Response.json({ id: result.id, name: result.name, webViewLink: result.webViewLink })
  } catch { return Response.json({ error: 'Create folder failed' }, { status: 500 }) }
}

async function handleShare(token: string, body: Record<string, unknown>): Promise<Response> {
  const { id, email, role } = body as { id?: string; email?: string; role?: string }
  if (!id || !email) return Response.json({ error: 'Missing id or email' }, { status: 400 })
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: role || 'reader', emailAddress: email }),
    })
    if (!r.ok) { const err = await r.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: r.status }) }
    return Response.json({ success: true, shared_with: email })
  } catch { return Response.json({ error: 'Share failed' }, { status: 500 }) }
}

async function handleCopy(token: string, body: Record<string, unknown>): Promise<Response> {
  const { id, name } = body as { id?: string; name?: string }
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 })
  try {
    const copyBody: Record<string, string> = {}
    if (name) copyBody.name = name
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/copy?fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(copyBody),
    })
    if (!r.ok) { const err = await r.json() as { error?: { message?: string } }; return Response.json({ error: 'Drive operation failed' }, { status: r.status }) }
    const result = await r.json() as { id: string; name: string; webViewLink: string }
    return Response.json({ id: result.id, name: result.name, webViewLink: result.webViewLink })
  } catch { return Response.json({ error: 'Copy failed' }, { status: 500 }) }
}
