import type { VercelRequest, VercelResponse } from '@vercel/node'
import pdf = require('pdf-parse')

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing access token' })

  const { type } = (req.method === 'GET' ? req.query : req.body) as { type?: string }

  switch (type) {
    case 'list': return handleList(token, req, res)
    case 'read': return handleRead(token, req, res)
    case 'create': return handleCreate(token, req, res)
    case 'update': return handleUpdate(token, req, res)
    case 'delete': return handleDelete(token, req, res)
    case 'rename': return handleRename(token, req, res)
    case 'move': return handleMove(token, req, res)
    case 'create_folder': return handleCreateFolder(token, req, res)
    case 'share': return handleShare(token, req, res)
    case 'copy': return handleCopy(token, req, res)
    default: return res.status(400).json({ error: 'Use type: list, read, create, delete, rename, move, create_folder' })
  }
}

async function handleList(token: string, req: VercelRequest, res: VercelResponse) {
  const folderId = (req.query.folderId || req.body?.folderId) as string | undefined
  const query = (req.query.q || req.body?.q) as string | undefined
  try {
    let q = 'trashed=false'
    if (folderId) q += ` and '${folderId}' in parents`
    if (query) q += ` and (fullText contains '${query.replace(/'/g, "\\'")}')`
    const params = new URLSearchParams({ q, fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)', orderBy: 'modifiedTime desc', pageSize: '200' })
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) {
      const errBody = await r.text()
      return res.status(r.status).json({ error: errBody, debug: { status: r.status, query: q } })
    }
    const data = await r.json()
    return res.status(200).json({ files: data.files || [], debug: { query: q, count: (data.files || []).length } })
  } catch { return res.status(500).json({ error: 'Failed to list files' }) }
}

async function handleRead(token: string, req: VercelRequest, res: VercelResponse) {
  const fileId = (req.query.id || req.body?.id) as string
  if (!fileId) return res.status(400).json({ error: 'Missing id' })
  try {
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,modifiedTime`, { headers: { Authorization: `Bearer ${token}` } })
    if (!metaRes.ok) { const err = await metaRes.json(); return res.status(metaRes.status).json({ error: err.error?.message }) }
    const meta = await metaRes.json()
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
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${token}` } })
      if (r.ok) {
        content = await r.text()
      } else {
        // Native PDF — download and parse with pdf-parse
        const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
        if (dlRes.ok) {
          const buffer = Buffer.from(await dlRes.arrayBuffer())
          try {
            const pdfData = await pdf(buffer)
            content = pdfData.text || ''
          } catch (e) {
            content = ''
          }
          // Check if extracted text is actually readable (not garbage/binary)
          const isReadable = (text: string) => {
            if (!text || text.trim().length < 50) return false
            // Count readable characters vs total
            const readable = text.replace(/[^\w\sàâäéèêëïîôùûüçœæÀÂÄÉÈÊËÏÎÔÙÛÜÇŒÆ.,;:!?€$%()/-]/g, '')
            return readable.length > text.length * 0.5
          }
          if (!isReadable(content)) {
            content = ''
          }
          // Regex fallback
          if (!content) {
            const raw = buffer.toString('latin1')
            const textParts: string[] = []
            const regex = /\(([^)]{2,})\)/g
            let m
            while ((m = regex.exec(raw)) !== null) {
              const t = m[1]
              if (t && !/^[\\\/\d\s.]+$/.test(t)) textParts.push(t)
            }
            if (textParts.length > 0) {
              content = textParts.join(' ').replace(/\\n/g, '\n').replace(/\\\(/g, '(').replace(/\\\)/g, ')')
            }
          }
          if (!isReadable(content)) {
            content = ''
          }
          if (!content) {
            // OCR fallback: use Google Vision API files:annotate for scanned PDFs
            try {
              const visionKey = process.env.GOOGLE_VISION_API_KEY
              if (visionKey) {
                const base64Data = buffer.toString('base64')
                const visionRes = await fetch(
                  `https://vision.googleapis.com/v1/files:annotate?key=${visionKey}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      requests: [{
                        inputConfig: {
                          content: base64Data,
                          mimeType: 'application/pdf',
                        },
                        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                        pages: [1, 2, 3, 4, 5],
                      }],
                    }),
                  }
                )
                if (visionRes.ok) {
                  const visionData = await visionRes.json()
                  const pages = visionData.responses?.[0]?.responses || []
                  const ocrText = pages
                    .map((p: { fullTextAnnotation?: { text?: string } }) => p.fullTextAnnotation?.text || '')
                    .filter(Boolean)
                    .join('\n\n--- Page suivante ---\n\n')
                  if (ocrText) {
                    content = `[OCR — texte extrait d'un PDF scanné, ${pages.length} pages]\n\n${ocrText}`
                  }
                }
              }
            } catch {
              // OCR failed silently
            }
          }
          if (!content) {
            content = `[PDF : ${meta.name} — impossible d'extraire le texte. Fichier probablement scanné/image. Taille: ${buffer.length} octets]`
          }
        }
      }
    } else {
      content = `[Fichier binaire : ${meta.name} (${meta.mimeType})]`
    }
    return res.status(200).json({ id: meta.id, name: meta.name, mimeType: meta.mimeType, modifiedTime: meta.modifiedTime, content: content.slice(0, 10000) })
  } catch { return res.status(500).json({ error: 'Failed to read file' }) }
}

async function handleCreate(token: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })
  const { name, content, mimeType, folderId } = req.body as { name?: string; content?: string; mimeType?: string; folderId?: string }
  if (!name || !content) return res.status(400).json({ error: 'Missing name or content' })
  try {
    const isGoogleDoc = !mimeType || mimeType === 'application/vnd.google-apps.document'
    const metadata: { name: string; mimeType?: string; parents?: string[] } = { name }
    if (isGoogleDoc) metadata.mimeType = 'application/vnd.google-apps.document'
    if (folderId) metadata.parents = [folderId]
    const boundary = 'fp_boundary'
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${isGoogleDoc ? 'text/plain' : mimeType || 'text/plain'}\r\n\r\n${content}\r\n--${boundary}--`
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const result = await r.json()
    return res.status(200).json({ id: result.id, name: result.name, webViewLink: result.webViewLink })
  } catch { return res.status(500).json({ error: 'Failed to create file' }) }
}

async function handleUpdate(token: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })
  const { id, content } = req.body as { id?: string; content?: string }
  if (!id || content === undefined) return res.status(400).json({ error: 'Missing id or content' })
  try {
    // Check if it's a Google Doc (need special handling)
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const meta = await metaRes.json()
    const isGoogleDoc = meta.mimeType === 'application/vnd.google-apps.document'

    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': isGoogleDoc ? 'text/plain' : 'application/json',
      },
      body: content,
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Update failed' }) }
}

async function handleDelete(token: string, req: VercelRequest, res: VercelResponse) {
  const fileId = (req.body?.id) as string
  if (!fileId) return res.status(400).json({ error: 'Missing id' })
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok && r.status !== 204) { const err = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (err as {error?: {message?: string}}).error?.message || 'Delete failed' }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Delete failed' }) }
}

async function handleRename(token: string, req: VercelRequest, res: VercelResponse) {
  const { id, name } = req.body as { id?: string; name?: string }
  if (!id || !name) return res.status(400).json({ error: 'Missing id or name' })
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true, name })
  } catch { return res.status(500).json({ error: 'Rename failed' }) }
}

async function handleMove(token: string, req: VercelRequest, res: VercelResponse) {
  const { id, folderId } = req.body as { id?: string; folderId?: string }
  if (!id || !folderId) return res.status(400).json({ error: 'Missing id or folderId' })
  try {
    // Get current parents
    const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=parents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const current = await getRes.json()
    const previousParents = (current.parents || []).join(',')

    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?addParents=${folderId}&removeParents=${previousParents}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Move failed' }) }
}

async function handleCreateFolder(token: string, req: VercelRequest, res: VercelResponse) {
  const { name, parentId } = req.body as { name?: string; parentId?: string }
  if (!name) return res.status(400).json({ error: 'Missing name' })
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
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const result = await r.json()
    return res.status(200).json({ id: result.id, name: result.name, webViewLink: result.webViewLink })
  } catch { return res.status(500).json({ error: 'Create folder failed' }) }
}

async function handleShare(token: string, req: VercelRequest, res: VercelResponse) {
  const { id, email, role } = req.body as { id?: string; email?: string; role?: string }
  if (!id || !email) return res.status(400).json({ error: 'Missing id or email' })
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: role || 'reader', emailAddress: email }),
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true, shared_with: email })
  } catch { return res.status(500).json({ error: 'Share failed' }) }
}

async function handleCopy(token: string, req: VercelRequest, res: VercelResponse) {
  const { id, name } = req.body as { id?: string; name?: string }
  if (!id) return res.status(400).json({ error: 'Missing id' })
  try {
    const body: Record<string, string> = {}
    if (name) body.name = name
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/copy?fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const result = await r.json()
    return res.status(200).json({ id: result.id, name: result.name, webViewLink: result.webViewLink })
  } catch { return res.status(500).json({ error: 'Copy failed' }) }
}
