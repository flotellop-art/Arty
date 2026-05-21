// Proxy Cloudflare pour convertir une URL de PDF PUBLIC en Markdown via
// l'endpoint Linkup /v1/fetch. Comble le trou où ni `web_fetch` (Claude)
// ni `url_context` (Gemini) ne savent lire un PDF binaire collé en chat —
// les deux attendent du HTML. Linkup renvoie du Markdown propre quel que
// soit le format. Réutilise LINKUP_API_KEY (déjà utilisée par /api/search/web).
//
// Sécurité (RÈGLE 6) :
//  - Auth obligatoire (checkAllowedUserPeek) — anti relais anonyme (CRIT-4).
//  - C'est Linkup qui fait le fetch sortant, PAS notre Worker : le SSRF
//    classique contre l'infra Cloudflare n'existe pas. La validation d'URL
//    ci-dessous évite quand même d'être un vecteur d'abus vers des hosts
//    internes via l'infra Linkup. Redirects + DNS rebinding non maîtrisables
//    côté Arty (acceptés explicitement).
//  - PDF-only + cap de sortie : limite l'abus de quota Linkup.
//  - Erreurs opaques : ne JAMAIS propager le body/status Linkup (Leak).
//  - Origin/CSRF : géré globalement par functions/api/_middleware.ts.

import type { Env } from '../../env'
import { checkAllowedUserPeek } from '../_lib/checkAllowedUser'

const MAX_URL_LEN = 2048
const MAX_MARKDOWN_CHARS = 200_000

function isSafePublicUrl(u: URL): boolean {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  if (u.port && u.port !== '80' && u.port !== '443') return false
  const h = u.hostname.toLowerCase()
  // Refuse les IP littérales (v4/v6) — un PDF public est servi par un nom de
  // domaine, jamais une IP brute. Couvre loopback/privé/link-local/metadata.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false
  if (h.includes(':')) return false
  // Refuse les hostnames internes / sans TLD.
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false
  if (!h.includes('.')) return false
  return true
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Peek : vérifie l'identité Google sans décrémenter le trial (endpoint
  // auxiliaire, comme /api/search/web).
  const user = await checkAllowedUserPeek(request, env)
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { url?: unknown }
  try {
    body = (await request.json()) as { url?: unknown }
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const rawUrl = body.url
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LEN) {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  if (!isSafePublicUrl(parsed)) {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // PDF uniquement — c'est la seule valeur ajoutée vs les tools natifs.
  if (!/\.pdf$/i.test(parsed.pathname)) {
    return Response.json({ error: 'Only PDF URLs are supported' }, { status: 400 })
  }

  if (!env.LINKUP_API_KEY) {
    return Response.json({ error: 'Fetch unavailable' }, { status: 503 })
  }

  try {
    const res = await fetch('https://api.linkup.so/v1/fetch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LINKUP_API_KEY}`,
      },
      body: JSON.stringify({
        url: parsed.toString(),
        includeRawHtml: false,
        extractImages: false,
      }),
    })
    if (!res.ok) {
      // Erreur opaque — ne pas révéler le status/body Linkup au client.
      return Response.json({ error: 'Fetch failed' }, { status: 502 })
    }
    const data = (await res.json()) as { markdown?: string }
    const markdown = (data.markdown ?? '').slice(0, MAX_MARKDOWN_CHARS)
    if (!markdown) {
      return Response.json({ error: 'Empty document' }, { status: 502 })
    }
    return Response.json({ markdown })
  } catch {
    return Response.json({ error: 'Fetch failed' }, { status: 502 })
  }
}
