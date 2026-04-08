import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' })
  }

  const messageId = req.query.id as string
  if (!messageId) {
    return res.status(400).json({ error: 'Missing message id' })
  }

  try {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!msgRes.ok) {
      const err = await msgRes.json()
      return res.status(msgRes.status).json({ error: err.error?.message || 'Gmail API error' })
    }

    const msg = await msgRes.json()
    const headers = msg.payload?.headers || []
    const getHeader = (name: string) =>
      headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

    // Extract body text
    let body = ''
    function extractText(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): void {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64url').toString('utf-8')
      }
      if (part.parts) {
        for (const sub of part.parts) {
          extractText(sub as typeof part)
        }
      }
    }
    extractText(msg.payload)

    // Fallback to HTML if no plain text
    if (!body) {
      function extractHtml(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): void {
        if (part.mimeType === 'text/html' && part.body?.data) {
          const html = Buffer.from(part.body.data, 'base64url').toString('utf-8')
          body = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        }
        if (part.parts) {
          for (const sub of part.parts) {
            extractHtml(sub as typeof part)
          }
        }
      }
      extractHtml(msg.payload)
    }

    return res.status(200).json({
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader('From'),
      to: getHeader('To'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      body: body.slice(0, 5000),
      snippet: msg.snippet || '',
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read message' })
  }
}
