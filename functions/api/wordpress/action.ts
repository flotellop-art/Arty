import type { Env } from '../../env'
import { verifyGoogleUserStrict, parseAllowedEmails, notFoundResponse } from '../_lib/checkAllowedUser'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // CRIT-4 + H-Back-4 (audit étape 2) — WordPress utilise un seul jeu d'identifiants
  // partagé (WP_USERNAME / WP_PASSWORD). Sans gate, chaque user authentifié
  // pouvait lister / créer / supprimer des posts WP en tant que owner. Restreint
  // aux emails dans WORDPRESS_OWNER_EMAILS (fallback ALLOWED_EMAILS).
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
  if (!email) return notFoundResponse()
  const ownerEmails = parseAllowedEmails(env.WORDPRESS_OWNER_EMAILS || env.ALLOWED_EMAILS)
  if (!ownerEmails.includes(email)) return notFoundResponse()

  const { WP_URL: wpUrl, WP_USERNAME: wpUser, WP_PASSWORD: wpPass } = env
  if (!wpUrl || !wpUser || !wpPass) return Response.json({ error: 'WordPress not configured' }, { status: 500 })

  const auth = btoa(`${wpUser}:${wpPass}`)
  const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }
  const apiBase = `${wpUrl}/wp-json/wp/v2`

  const body = await request.json() as Record<string, unknown>
  const type = body.type as string | undefined

  // Audit F-22 (3 juil. 2026) — postId (body client) est interpolé dans l'URL
  // REST WP : un id non numérique permettrait d'atteindre un autre chemin de
  // l'API (`123/revisions`, query-string…). Entier strict uniquement.
  const postId = Number(body.postId)
  const postIdValid = Number.isInteger(postId) && postId > 0

  try {
    switch (type) {
      case 'list': {
        const params = new URLSearchParams({ per_page: String(body.per_page || 10), status: String(body.status || 'any') })
        const r = await fetch(`${apiBase}/posts?${params}`, { headers })
        if (!r.ok) return Response.json({ error: 'Failed to list posts' }, { status: r.status })
        const posts = await r.json() as Array<Record<string, unknown>>
        const list = posts.map((p) => ({
          id: p.id, title: (p.title as Record<string, string>)?.rendered, status: p.status, date: p.date, link: p.link,
        }))
        return Response.json({ posts: list })
      }

      case 'create': {
        if (!body.title || !body.content) return Response.json({ error: 'Missing title or content' }, { status: 400 })
        const payload: Record<string, unknown> = { title: body.title, content: body.content, status: body.status || 'draft' }
        if (body.date) payload.date = body.date
        if (body.categories) payload.categories = body.categories
        if (body.tags) payload.tags = body.tags
        const r = await fetch(`${apiBase}/posts`, { method: 'POST', headers, body: JSON.stringify(payload) })
        if (!r.ok) return Response.json({ error: 'Create failed' }, { status: r.status })
        const post = await r.json() as Record<string, unknown>
        return Response.json({ id: post.id, title: (post.title as Record<string, string>)?.rendered, status: post.status, link: post.link })
      }

      case 'update': {
        if (!postIdValid) return Response.json({ error: 'Missing or invalid postId' }, { status: 400 })
        const payload: Record<string, unknown> = {}
        if (body.title) payload.title = body.title
        if (body.content) payload.content = body.content
        if (body.status) payload.status = body.status
        const r = await fetch(`${apiBase}/posts/${postId}`, { method: 'POST', headers, body: JSON.stringify(payload) })
        if (!r.ok) return Response.json({ error: 'Update failed' }, { status: r.status })
        const post = await r.json() as Record<string, unknown>
        return Response.json({ id: post.id, title: (post.title as Record<string, string>)?.rendered, status: post.status, link: post.link })
      }

      case 'delete': {
        if (!postIdValid) return Response.json({ error: 'Missing or invalid postId' }, { status: 400 })
        const r = await fetch(`${apiBase}/posts/${postId}`, { method: 'DELETE', headers })
        if (!r.ok) return Response.json({ error: 'Delete failed' }, { status: r.status })
        return Response.json({ success: true })
      }

      case 'get': {
        if (!postIdValid) return Response.json({ error: 'Missing or invalid postId' }, { status: 400 })
        const r = await fetch(`${apiBase}/posts/${postId}`, { headers })
        if (!r.ok) return Response.json({ error: 'Not found' }, { status: r.status })
        const post = await r.json() as Record<string, unknown>
        return Response.json({
          id: post.id, title: (post.title as Record<string, string>)?.rendered,
          content: (post.content as Record<string, string>)?.rendered,
          status: post.status, date: post.date, link: post.link,
        })
      }

      default:
        return Response.json({ error: 'Use type: list, create, update, delete, get' }, { status: 400 })
    }
  } catch (err) {
    return Response.json({ error: 'WordPress operation failed' }, { status: 500 })
  }
}
