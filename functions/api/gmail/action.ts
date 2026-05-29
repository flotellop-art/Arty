import type { Env } from '../../env'
import { decodeBase64Url, decodePartBody, htmlToText, type MimePart } from './_lib'
import { verifyGoogleUser, notFoundResponse } from '../_lib/checkAllowedUser'

// MIME types that Claude can read natively as document/image content
// blocks. Forwarded as base64 to the client tool wrapper, which packs
// them into a Claude `document` or `image` block.
const FORWARDABLE_MIMES = new Set([
  'application/pdf',
  // Office (Claude reads these as documents)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
])

function isForwardableBinary(mimeType: string): boolean {
  if (!mimeType) return false
  const lower = mimeType.toLowerCase()
  if (FORWARDABLE_MIMES.has(lower)) return true
  if (lower.startsWith('image/')) return true
  return false
}

// Convert Uint8Array to base64 efficiently. Chunk by 8KB and use apply()
// instead of the naïve per-byte fromCharCode loop, which is O(n²) due to
// string concatenation and crashes on Cloudflare Workers (128MB RAM, 30s
// timeout) for attachments > ~2MB. (BUG 50)
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000 // 32KB
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    parts.push(String.fromCharCode.apply(null, Array.from(slice)))
  }
  return btoa(parts.join(''))
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // CRIT-4 (audit étape 2) — exiger un user Google identifié.
  const email = await verifyGoogleUser(request, env)
  if (!email) return notFoundResponse()

  const token = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return notFoundResponse()

  const body = await request.json() as Record<string, unknown>
  // H-Back-5 — borner les champs string longs (query Gmail search).
  if (typeof body.query === 'string' && body.query.length > 500) {
    return Response.json({ error: 'Query too long (max 500)' }, { status: 400 })
  }
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
    if (!listRes.ok) { const err = await listRes.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: listRes.status }) }
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
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: r.status }) }
    const msg = await r.json() as Record<string, unknown>
    const payload = msg.payload as Record<string, unknown>
    const headers = (payload?.headers || []) as Array<{ name: string; value: string }>
    const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value || ''

    // Charset-aware extraction (BUG 49). RFC 2045 §5.1 says MIME types
    // are case-insensitive — we lowercase before matching to handle
    // mailers that send "Text/Plain" or "TEXT/HTML".
    let msgBody = ''
    function extract(part: MimePart, mime: string) {
      if (part.mimeType?.toLowerCase() === mime && part.body?.data) {
        let text = decodePartBody(part)
        if (mime === 'text/html') text = htmlToText(text)
        msgBody += text
      }
      if (part.parts) for (const s of part.parts) extract(s, mime)
    }
    const root = payload as MimePart
    extract(root, 'text/plain')
    if (!msgBody) extract(root, 'text/html')

    // Extract attachments info
    const attachments: Array<{ id: string; filename: string; mimeType: string; size: number }> = []
    function findAttachments(part: MimePart) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        })
      }
      if (part.parts) for (const s of part.parts) findAttachments(s)
    }
    findAttachments(root)

    // Fallback to snippet when extraction yielded nothing (encrypted
    // S/MIME body, exotic encoding, etc.) — Gmail always returns a
    // ~200-char preview. Truncated at 8000 chars (was 5000) to fit
    // longer business mails.
    const finalBody = (msgBody || (typeof msg.snippet === 'string' ? msg.snippet : '')).slice(0, 8000)

    return Response.json({ id: msg.id, threadId: msg.threadId, from: h('From'), to: h('To'), subject: h('Subject'), date: h('Date'), body: finalBody, snippet: msg.snippet || '', attachments })
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
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: r.status }) }
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
    if (!listRes.ok) { const err = await listRes.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: listRes.status }) }
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
  // Optional metadata passed by the client from the prior `read_email`
  // result. The Gmail attachment endpoint returns only raw bytes, no
  // filename/mimeType — without these hints we'd have to refetch the
  // parent message just to find out the type, which is wasteful.
  const hintMime = (body.mimeType as string | undefined) || ''
  const hintName = (body.filename as string | undefined) || ''
  if (!messageId || !attachmentId) return Response.json({ error: 'Missing message_id or attachment_id' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId) || !/^[a-zA-Z0-9_-]+$/.test(attachmentId)) {
    return Response.json({ error: 'Invalid message or attachment ID' }, { status: 400 })
  }

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) {
      // Surface Gmail's actual error message instead of a generic string
      // so the model can decide what to do (retry, skip, ask user).
      let detail = `HTTP ${r.status}`
      try {
        const err = await r.json() as { error?: { message?: string } }
        if (err.error?.message) detail = err.error.message
      } catch { /* non-JSON body, keep status code */ }
      return Response.json({ error: `Gmail attachment fetch failed: ${detail}` }, { status: r.status })
    }
    const data = await r.json() as Record<string, unknown>

    const bytes = decodeBase64Url((data.data as string) || '')

    // Size cap : Claude API attachment limit = 20MB. Au-delà, on rejette
    // pour éviter l'OOM Worker + une réponse base64 inutilisable.
    if (bytes.length > 20 * 1024 * 1024) {
      return Response.json({ error: 'Attachment too large (max 20MB)' }, { status: 413 })
    }

    // PDF detection by magic bytes (works even when the client didn't
    // pass a hint mimeType).
    const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46

    let detectedMime = hintMime
    if (isPdf) detectedMime = 'application/pdf'

    if (isForwardableBinary(detectedMime)) {
      // Forward raw bytes — Claude reads PDFs/Office/images natively
      // via document/image content blocks, no server-side OCR needed.
      // pdf-parse is Node-only and doesn't run on Workers anyway.
      return Response.json({
        base64: bytesToBase64(bytes),
        mimeType: detectedMime,
        filename: hintName || undefined,
        size: bytes.length,
        type: detectedMime.startsWith('image/') ? 'image' : (detectedMime === 'application/pdf' ? 'pdf' : 'document'),
      })
    }

    // Try plain text (charset detection isn't possible without the
    // parent part headers, so we default to UTF-8).
    const text = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes)
    if (text && !text.includes('\x00')) {
      return Response.json({ content: text.slice(0, 10000), type: 'text' })
    }

    return Response.json({ content: '[Fichier binaire — contenu non lisible en texte]', type: 'binary' })
  } catch { return Response.json({ error: 'Failed to read attachment' }, { status: 500 }) }
}

async function handleArchive(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  if (!messageId) return Response.json({ error: 'Missing id' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) return Response.json({ error: 'Invalid message ID' }, { status: 400 })

  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Archive failed' }, { status: 500 }) }
}

async function handleDelete(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  if (!messageId) return Response.json({ error: 'Missing id' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) return Response.json({ error: 'Invalid message ID' }, { status: 400 })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Delete failed' }, { status: 500 }) }
}

async function handleStar(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  if (!messageId) return Response.json({ error: 'Missing id' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) return Response.json({ error: 'Invalid message ID' }, { status: 400 })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: ['STARRED'] }),
      }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: r.status }) }
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
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: r.status }) }
    const result = await r.json() as Record<string, unknown>
    return Response.json({ id: result.id, success: true })
  } catch { return Response.json({ error: 'Draft failed' }, { status: 500 }) }
}

async function handleLabel(token: string, body: Record<string, unknown>): Promise<Response> {
  const messageId = body.id as string
  const label = body.label as string
  if (!messageId || !label) return Response.json({ error: 'Missing id or label' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]+$/.test(messageId)) return Response.json({ error: 'Invalid message ID' }, { status: 400 })
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: [label.toUpperCase()] }),
      }
    )
    if (!r.ok) { const err = await r.json() as Record<string, unknown>; return Response.json({ error: 'Gmail operation failed' }, { status: r.status }) }
    return Response.json({ success: true })
  } catch { return Response.json({ error: 'Label failed' }, { status: 500 }) }
}
