import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' })
  }

  const folderId = req.query.folderId as string | undefined
  const query = req.query.q as string | undefined

  try {
    let q = 'trashed=false'
    if (folderId) {
      q += ` and '${folderId}' in parents`
    }
    if (query) {
      q += ` and (name contains '${query.replace(/'/g, "\\'")}')`
    }

    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)',
      orderBy: 'modifiedTime desc',
      pageSize: '20',
    })

    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!listRes.ok) {
      const err = await listRes.json()
      return res.status(listRes.status).json({ error: err.error?.message || 'Drive API error' })
    }

    const data = await listRes.json()
    return res.status(200).json({ files: data.files || [] })
  } catch (err) {
    return res.status(500).json({ error: 'Failed to list files' })
  }
}
