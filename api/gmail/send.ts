import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' })
  }

  const { to, subject, body, threadId, inReplyTo } = req.body as {
    to?: string
    subject?: string
    body?: string
    threadId?: string
    inReplyTo?: string
  }

  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Missing to, subject, or body' })
  }

  try {
    // Build RFC 2822 message
    const headers = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
    ]
    if (inReplyTo) {
      headers.push(`In-Reply-To: ${inReplyTo}`)
      headers.push(`References: ${inReplyTo}`)
    }

    const rawMessage = headers.join('\r\n') + '\r\n\r\n' + body
    const encoded = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const sendBody: { raw: string; threadId?: string } = { raw: encoded }
    if (threadId) {
      sendBody.threadId = threadId
    }

    const sendRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      }
    )

    if (!sendRes.ok) {
      const err = await sendRes.json()
      return res.status(sendRes.status).json({ error: err.error?.message || 'Gmail send error' })
    }

    const result = await sendRes.json()
    return res.status(200).json({ id: result.id, threadId: result.threadId })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to send email' })
  }
}
