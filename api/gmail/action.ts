import type { VercelRequest, VercelResponse } from '@vercel/node'
import pdf = require('pdf-parse')

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing access token' })

  const { type } = (req.method === 'GET' ? req.query : req.body) as { type?: string }

  switch (type) {
    case 'list': return handleList(token, res)
    case 'read': return handleRead(token, req, res)
    case 'send': return handleSend(token, req, res)
    case 'search': return handleSearch(token, req, res)
    case 'attachment': return handleAttachment(token, req, res)
    case 'archive': return handleArchive(token, req, res)
    case 'delete': return handleDelete(token, req, res)
    case 'star': return handleStar(token, req, res)
    case 'draft': return handleDraft(token, req, res)
    case 'label': return handleLabel(token, req, res)
    default: return res.status(400).json({ error: 'Use type: list, read, send, search, archive, delete, star, draft, label' })
  }
}

async function handleList(token: string, res: VercelResponse) {
  try {
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=10',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!listRes.ok) { const err = await listRes.json(); return res.status(listRes.status).json({ error: err.error?.message }) }
    const listData = await listRes.json()
    const ids: string[] = (listData.messages || []).map((m: { id: string }) => m.id)
    if (ids.length === 0) return res.status(200).json({ messages: [] })

    const details = await Promise.all(ids.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!r.ok) return null
      const msg = await r.json()
      const headers = msg.payload?.headers || []
      const h = (n: string) => headers.find((x: { name: string; value: string }) => x.name.toLowerCase() === n.toLowerCase())?.value || ''
      return { id: msg.id, threadId: msg.threadId, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: msg.snippet || '' }
    }))
    return res.status(200).json({ messages: details.filter(Boolean) })
  } catch { return res.status(500).json({ error: 'Failed to fetch messages' }) }
}

async function handleRead(token: string, req: VercelRequest, res: VercelResponse) {
  const messageId = (req.query.id || req.body?.id) as string
  if (!messageId) return res.status(400).json({ error: 'Missing id' })

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const msg = await r.json()
    const headers = msg.payload?.headers || []
    const h = (n: string) => headers.find((x: { name: string; value: string }) => x.name.toLowerCase() === n.toLowerCase())?.value || ''

    let body = ''
    function extract(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }, mime: string) {
      if (part.mimeType === mime && part.body?.data) {
        let text = Buffer.from(part.body.data, 'base64url').toString('utf-8')
        if (mime === 'text/html') text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        body += text
      }
      if (part.parts) for (const s of part.parts) extract(s as typeof part, mime)
    }
    extract(msg.payload, 'text/plain')
    if (!body) extract(msg.payload, 'text/html')

    // Extract attachments info
    const attachments: Array<{ id: string; filename: string; mimeType: string; size: number }> = []
    function findAttachments(part: { filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: unknown[] }) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        })
      }
      if (part.parts) for (const s of part.parts) findAttachments(s as typeof part)
    }
    findAttachments(msg.payload)

    return res.status(200).json({ id: msg.id, threadId: msg.threadId, from: h('From'), to: h('To'), subject: h('Subject'), date: h('Date'), body: body.slice(0, 5000), snippet: msg.snippet || '', attachments })
  } catch { return res.status(500).json({ error: 'Failed to read message' }) }
}

async function handleSend(token: string, req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' })
  const { to, subject, body, threadId, inReplyTo } = req.body as { to?: string; subject?: string; body?: string; threadId?: string; inReplyTo?: string }
  if (!to || !subject || !body) return res.status(400).json({ error: 'Missing to, subject, or body' })

  try {
    const hdrs = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8']
    if (inReplyTo) { hdrs.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`) }
    const raw = hdrs.join('\r\n') + '\r\n\r\n' + body
    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const sendBody: { raw: string; threadId?: string } = { raw: encoded }
    if (threadId) sendBody.threadId = threadId

    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(sendBody),
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const result = await r.json()
    return res.status(200).json({ id: result.id, threadId: result.threadId })
  } catch { return res.status(500).json({ error: 'Failed to send' }) }
}

async function handleSearch(token: string, req: VercelRequest, res: VercelResponse) {
  const query = (req.body?.query || req.query.query) as string
  if (!query) return res.status(400).json({ error: 'Missing query' })

  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!listRes.ok) { const err = await listRes.json(); return res.status(listRes.status).json({ error: err.error?.message }) }
    const listData = await listRes.json()
    const ids: string[] = (listData.messages || []).map((m: { id: string }) => m.id)
    if (ids.length === 0) return res.status(200).json({ messages: [] })

    const details = await Promise.all(ids.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!r.ok) return null
      const msg = await r.json()
      const headers = msg.payload?.headers || []
      const h = (n: string) => headers.find((x: { name: string; value: string }) => x.name.toLowerCase() === n.toLowerCase())?.value || ''
      return { id: msg.id, threadId: msg.threadId, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: msg.snippet || '' }
    }))
    return res.status(200).json({ messages: details.filter(Boolean) })
  } catch { return res.status(500).json({ error: 'Search failed' }) }
}

async function handleAttachment(token: string, req: VercelRequest, res: VercelResponse) {
  const messageId = (req.body?.message_id || req.query.message_id) as string
  const attachmentId = (req.body?.attachment_id || req.query.attachment_id) as string
  if (!messageId || !attachmentId) return res.status(400).json({ error: 'Missing message_id or attachment_id' })

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const data = await r.json()

    // Decode base64url attachment data
    const base64 = (data.data || '').replace(/-/g, '+').replace(/_/g, '/')
    const buffer = Buffer.from(base64, 'base64')

    // Try to extract text based on content type
    // Check if it's a PDF by looking at the magic bytes
    const isPdf = buffer.length > 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46

    if (isPdf) {
      try {
        const pdfData = await pdf(buffer)
        return res.status(200).json({ content: pdfData.text.slice(0, 10000), type: 'pdf', pages: pdfData.numpages })
      } catch {
        return res.status(200).json({ content: '[PDF — impossible d\'extraire le texte (scanné/image ?)]', type: 'pdf' })
      }
    }

    // Try plain text
    const text = buffer.toString('utf-8')
    if (text && !text.includes('\x00')) {
      return res.status(200).json({ content: text.slice(0, 10000), type: 'text' })
    }

    return res.status(200).json({ content: '[Fichier binaire — contenu non lisible en texte]', type: 'binary' })
  } catch { return res.status(500).json({ error: 'Failed to read attachment' }) }
}

async function handleArchive(token: string, req: VercelRequest, res: VercelResponse) {
  const messageId = (req.body?.id || req.query.id) as string
  if (!messageId) return res.status(400).json({ error: 'Missing id' })

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Archive failed' }) }
}

async function handleDelete(token: string, req: VercelRequest, res: VercelResponse) {
  const messageId = (req.body?.id) as string
  if (!messageId) return res.status(400).json({ error: 'Missing id' })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Delete failed' }) }
}

async function handleStar(token: string, req: VercelRequest, res: VercelResponse) {
  const messageId = (req.body?.id) as string
  if (!messageId) return res.status(400).json({ error: 'Missing id' })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['STARRED'] }),
      }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Star failed' }) }
}

async function handleDraft(token: string, req: VercelRequest, res: VercelResponse) {
  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string }
  if (!subject || !body) return res.status(400).json({ error: 'Missing subject or body' })
  try {
    const hdrs = [`Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8']
    if (to) hdrs.unshift(`To: ${to}`)
    const raw = hdrs.join('\r\n') + '\r\n\r\n' + body
    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded } }),
    })
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    const result = await r.json()
    return res.status(200).json({ id: result.id, success: true })
  } catch { return res.status(500).json({ error: 'Draft failed' }) }
}

async function handleLabel(token: string, req: VercelRequest, res: VercelResponse) {
  const { id: messageId, label } = req.body as { id?: string; label?: string }
  if (!messageId || !label) return res.status(400).json({ error: 'Missing id or label' })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: [label.toUpperCase()] }),
      }
    )
    if (!r.ok) { const err = await r.json(); return res.status(r.status).json({ error: err.error?.message }) }
    return res.status(200).json({ success: true })
  } catch { return res.status(500).json({ error: 'Label failed' }) }
}
