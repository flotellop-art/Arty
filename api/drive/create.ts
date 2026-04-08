import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' })
  }

  const { name, content, mimeType, folderId } = req.body as {
    name?: string
    content?: string
    mimeType?: string
    folderId?: string
  }

  if (!name || !content) {
    return res.status(400).json({ error: 'Missing name or content' })
  }

  try {
    const isGoogleDoc = !mimeType || mimeType === 'application/vnd.google-apps.document'

    // Metadata
    const metadata: { name: string; mimeType?: string; parents?: string[] } = { name }
    if (isGoogleDoc) {
      metadata.mimeType = 'application/vnd.google-apps.document'
    }
    if (folderId) {
      metadata.parents = [folderId]
    }

    // Multipart upload
    const boundary = 'facade_pollet_boundary'
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${isGoogleDoc ? 'text/plain' : mimeType || 'text/plain'}`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n')

    const createRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    )

    if (!createRes.ok) {
      const err = await createRes.json()
      return res.status(createRes.status).json({ error: err.error?.message || 'Drive create error' })
    }

    const result = await createRes.json()
    return res.status(200).json({
      id: result.id,
      name: result.name,
      webViewLink: result.webViewLink,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create file' })
  }
}
