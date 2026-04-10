import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const wpUrl = process.env.WP_URL
  const wpUser = process.env.WP_USERNAME
  const wpPass = process.env.WP_PASSWORD
  if (!wpUrl || !wpUser || !wpPass) return res.status(500).json({ error: 'WordPress not configured' })

  const auth = Buffer.from(`${wpUser}:${wpPass}`).toString('base64')
  const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }
  const apiBase = `${wpUrl}/wp-json/wp/v2`

  const { type } = req.body as { type?: string }

  try {
    switch (type) {
      case 'list': {

        const { status, per_page } = req.body as { status?: string; per_page?: number }
        const params = new URLSearchParams({ per_page: String(per_page || 10), status: status || 'any' })
        const r = await fetch(`${apiBase}/posts?${params}`, { headers })
        if (!r.ok) return res.status(r.status).json({ error: 'Failed to list posts' })
        const posts = await r.json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list = posts.map((p: any) => ({
          id: p.id, title: p.title?.rendered, status: p.status, date: p.date, link: p.link,
        }))
        return res.status(200).json({ posts: list })
      }

      case 'create': {
        const { title, content, status, date, categories, tags } = req.body as {
          title?: string; content?: string; status?: string; date?: string; categories?: number[]; tags?: number[]
        }
        if (!title || !content) return res.status(400).json({ error: 'Missing title or content' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = { title, content, status: status || 'draft' }
        if (date) body.date = date
        if (categories) body.categories = categories
        if (tags) body.tags = tags

        const r = await fetch(`${apiBase}/posts`, { method: 'POST', headers, body: JSON.stringify(body) })
        if (!r.ok) { const err = await r.json().catch(() => ({})); return res.status(r.status).json({ error: (err as {message?: string}).message || 'Create failed' }) }
        const post = await r.json()
        return res.status(200).json({ id: post.id, title: post.title?.rendered, status: post.status, link: post.link })
      }

      case 'update': {
        const { postId, title, content, status } = req.body as { postId?: number; title?: string; content?: string; status?: string }
        if (!postId) return res.status(400).json({ error: 'Missing postId' })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const body: any = {}
        if (title) body.title = title
        if (content) body.content = content
        if (status) body.status = status

        const r = await fetch(`${apiBase}/posts/${postId}`, { method: 'POST', headers, body: JSON.stringify(body) })
        if (!r.ok) return res.status(r.status).json({ error: 'Update failed' })
        const post = await r.json()
        return res.status(200).json({ id: post.id, title: post.title?.rendered, status: post.status, link: post.link })
      }

      case 'delete': {
        const { postId } = req.body as { postId?: number }
        if (!postId) return res.status(400).json({ error: 'Missing postId' })
        const r = await fetch(`${apiBase}/posts/${postId}`, { method: 'DELETE', headers })
        if (!r.ok) return res.status(r.status).json({ error: 'Delete failed' })
        return res.status(200).json({ success: true })
      }

      case 'get': {
        const { postId } = req.body as { postId?: number }
        if (!postId) return res.status(400).json({ error: 'Missing postId' })
        const r = await fetch(`${apiBase}/posts/${postId}`, { headers })
        if (!r.ok) return res.status(r.status).json({ error: 'Not found' })
        const post = await r.json()
        return res.status(200).json({
          id: post.id, title: post.title?.rendered, content: post.content?.rendered,
          status: post.status, date: post.date, link: post.link,
        })
      }

      default:
        return res.status(400).json({ error: 'Use type: list, create, update, delete, get' })
    }
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'WordPress API error' })
  }
}
