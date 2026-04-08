import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' })
  }

  const fileId = req.query.id as string
  if (!fileId) {
    return res.status(400).json({ error: 'Missing file id' })
  }

  try {
    // Get file metadata first
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,modifiedTime`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!metaRes.ok) {
      const err = await metaRes.json()
      return res.status(metaRes.status).json({ error: err.error?.message || 'Drive API error' })
    }

    const meta = await metaRes.json()
    let content = ''

    if (meta.mimeType === 'application/vnd.google-apps.document') {
      // Export Google Docs as plain text
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (exportRes.ok) {
        content = await exportRes.text()
      }
    } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      // Export Google Sheets as CSV
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (exportRes.ok) {
        content = await exportRes.text()
      }
    } else if (meta.mimeType?.startsWith('text/')) {
      // Download text files directly
      const dlRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (dlRes.ok) {
        content = await dlRes.text()
      }
    } else {
      content = `[Fichier binaire : ${meta.name} (${meta.mimeType})]`
    }

    return res.status(200).json({
      id: meta.id,
      name: meta.name,
      mimeType: meta.mimeType,
      modifiedTime: meta.modifiedTime,
      content: content.slice(0, 10000),
    })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read file' })
  }
}
