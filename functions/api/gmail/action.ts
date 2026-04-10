import type { Env } from '../../env'

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return Response.json({ error: 'Missing authorization token' }, { status: 401 })

  const body = await request.json() as Record<string, unknown>
  const type = body.type as string | undefined

  const handlers: Record<string, (token: string, body: Record<string, unknown>) => Promise<Response>> = {
    list: handleList,
    read: handleRead,
    send: handleSend,
    search: handleSearch,
    attachment: handleAttachment,
    archive: handleArchive,
    delete: handleDelete,
    star: handleStar,
    draft: handleDraft,
    label: handleLabel,
  }

  const handler = type ? handlers[type] : undefined
  if (!handler) return Response.json({ error: `Use type: ${Object.keys(handlers).join(', ')}` }, { status: 400 })

  return handler(token, body)
}

async function handleList(token: string, _body: Record<string, unknown>): Promise<Response> {
  try {
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=10',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!listRes.ok) { const err = await listRes.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: listRes.status }) }
    const listData = await listRes.json() as Record<string, unknown>
    const ids: string[] = ((listData.messages || []) as Array<{ id: string }>).map((m) => m.id)
    if (ids.length === 0) return Response.json({ messages: [] })

    const details = await Promise.all(ids.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!r.ok) return null
      const msg = await r.json() as Record<string, unknown>
      const headers = (msg.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> || []
      const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value || ''
      return { id: msg.id, threadId: msg.threadId, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: msg.snippet || '' }
    }))
    return Response.json({ messages: details.filter(Boolean) })
  } catch { return Response.json({ error: 'Failed to fetch messages' }, { status: 500 }) }
}

async function handleRead(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  if (!messageId) return Response.json({ error: 'Missing id' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) return Response.json({ error: 'Invalid message ID' }, { status: 400 })

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    const msg = await r.json() as Record<string, unknown>
    const payload = msg.payload as Record<string, unknown>
    const headers = (payload?.headers || []) as Array<{ name: string; value: string }>
    const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value || ''

    let msgBody = ''
    function extract(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }, mime: string) {
      if (part.mimeType === mime && part.body?.data) {
        let text = Buffer.from(part.body.data, 'base64url').toString('utf-8')
        if (mime === 'text/html') text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        msgBody += text
      }
      if (part.parts) for (const s of part.parts) extract(s as typeof part, mime)
    }
    extract(payload as Parameters<typeof extract>[0], 'text/plain')
    if (!msgBody) extract(payload as Parameters<typeof extract>[0], 'text/html')

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
    findAttachments(payload as Parameters<typeof findAttachments>[0])

    return Response.json({ id: msg.id, threadId: msg.threadId, from: h('From'), to: h('To'), subject: h('Subject'), date: h('Date'), body: msgBody.slice(0, 5000), snippet: msg.snippet || '', attachments })
  } catch { return Response.json({ error: 'Failed to read message' }, { status: 500 }) }
}

async function handleSend(token: string, body: Record<string, unknown>): Promise<Response> {
  const { to, subject, body: emailBody, threadId, inReplyTo } = body as { to?: string; subject?: string; body?: string; threadId?: string; inReplyTo?: string }
  if (!to || !subject || !emailBody) return Response.json({ error: 'Missing to, subject, or body' }, { status: 400 })

  try {
    const hdrs = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8']
    if (inReplyTo) { hdrs.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`) }
    const raw = hdrs.join('\r\n') + '\r\n\r\n' + emailBody
    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const sendBody: { raw: string; threadId?: string } = { raw: encoded }
    if (threadId) sendBody.threadId = threadId

    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(sendBody),
    })
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    const result = await r.json() as Record<string, unknown>
    return Response.json({ id: result.id, threadId: result.threadId })
  } catch { return Response.json({ error: 'Failed to send' }, { status: 500 }) }
}

async function handleSearch(token: string, body: Record<string, unknown>): Promise<Response> {
  const query = body.query as string
  if (!query) return Response.json({ error: 'Missing query' }, { status: 400 })

  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!listRes.ok) { const err = await listRes.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: listRes.status }) }
    const listData = await listRes.json() as Record<string, unknown>
    const ids: string[] = ((listData.messages || []) as Array<{ id: string }>).map((m) => m.id)
    if (ids.length === 0) return Response.json({ messages: [] })

    const details = await Promise.all(ids.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!r.ok) return null
      const msg = await r.json() as Record<string, unknown>
      const headers = (msg.payload as Record<string, unknown>)?.headers as Array<{ name: string; value: string }> || []
      const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value || ''
      return { id: msg.id, threadId: msg.threadId, from: h('From'), subject: h('Subject'), date: h('Date'), snippet: msg.snippet || '' }
    }))
    return Response.json({ messages: details.filter(Boolean) })
  } catch { return Response.json({ error: 'Search failed' }, { status: 500 }) }
}

async function handleAttachment(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.message_id as string
  const attachmentId = body.attachment_id as string
  if (!messageId || !attachmentId) return Response.json({ error: 'Missing message_id or attachment_id' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId) || !/^[a-zA-Z0-9_-]+$/.test(attachmentId)) {
    return Response.json({ error: 'Invalid message or attachment ID' }, { status: 400 })
  }

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    const data = await r.json() as Record<string, unknown>

    // Decode base64url attachment data
    const base64 = ((data.data as string) || '').replace(/-/g, '+').replace(/_/g, '/')
    const buffer = Buffer.from(base64, 'base64')

    // Check if it's a PDF by looking at the magic bytes
    const isPdf = buffer.length > 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46

    if (isPdf) {
      // PDF text extraction / OCR is not available on this platform (Workers runtime)
      return Response.json({ content: '[PDF document — text extraction is not available on this platform]', type: 'pdf', pages: 0 })
    }

    // Try plain text
    const text = buffer.toString('utf-8')
    if (text && !text.includes('\x00')) {
      return Response.json({ content: text.slice(0, 10000), type: 'text' })
    }

    return Response.json({ content: '[Fichier binaire — contenu non lisible en texte]', type: 'binary' })
  } catch { return Response.json({ error: 'Failed to read attachment' }, { status: 500 }) }
}

async function handleArchive(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  if (!messageId) return Response.json({ error: 'Missing id' }, { status: 400 })

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Archive failed' }, { status: 500 }) }
}

async function handleDelete(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  if (!messageId) return Response.json({ error: 'Missing id' }, { status: 400 })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Delete failed' }, { status: 500 }) }
}

async function handleStar(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  if (!messageId) return Response.json({ error: 'Missing id' }, { status: 400 })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['STARRED'] }),
      }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Star failed' }, { status: 500 }) }
}

async function handleDraft(token: string, body: Record<string, unknown>): Promise<Response> {
  const { to, subject, body: draftBody } = body as { to?: string; subject?: string; body?: string }
  if (!subject || !draftBody) return Response.json({ error: 'Missing subject or body' }, { status: 400 })
  try {
    const hdrs = [`Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8']
    if (to) hdrs.unshift(`To: ${to}`)
    const raw = hdrs.join('\r\n') + '\r\n\r\n' + draftBody
    const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded } }),
    })
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    const result = await r.json() as Record<string, unknown>
    return Response.json({ id: result.id, success: true })
  } catch { return Response.json({ error: 'Draft failed' }, { status: 500 }) }
}

async function handleLabel(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  const label = body.label as string
  if (!messageId || !label) return Response.json({ error: 'Missing id or label' }, { status: 400 })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: [label.toUpperCase()] }),
      }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: (err.error as Record<string, string>)?.message }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Label failed' }, { status: 500 }) }
}
