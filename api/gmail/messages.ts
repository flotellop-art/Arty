import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' })
  }

  try {
    // Fetch unread messages
    const listRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=10',
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!listRes.ok) {
      const err = await listRes.json()
      return res.status(listRes.status).json({ error: err.error?.message || 'Gmail API error' })
    }

    const listData = await listRes.json()
    const messageIds: string[] = (listData.messages || []).map((m: { id: string }) => m.id)

    if (messageIds.length === 0) {
      return res.status(200).json({ messages: [] })
    }

    // Fetch details for each message
    const details = await Promise.all(
      messageIds.map(async (id) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!msgRes.ok) return null
        const msg = await msgRes.json()

        const headers = msg.payload?.headers || []
        const getHeader = (name: string) =>
          headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

        return {
          id: msg.id,
          threadId: msg.threadId,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          snippet: msg.snippet || '',
        }
      })
    )

    return res.status(200).json({
      messages: details.filter(Boolean),
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch messages' })
  }
}
