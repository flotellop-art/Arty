// Proxy Cloudflare pour les recherches web côté Mistral. Routable entre
// plusieurs providers via SEARCH_PROVIDER (linkup par défaut, brave en
// fallback, brave/serpapi/etc. extensible). Garde la clé serveur côté
// Cloudflare — jamais exposée au client.
//
// Pourquoi un proxy : (1) cacher la clé API search, (2) appliquer la
// whitelist Google (anti-relais anonyme RÈGLE 6), (3) tracker l'usage
// pour facturer/cap par user, (4) permettre de switcher de provider
// sans toucher au client.

import type { Env } from '../../env'
import { checkAllowedUserPeek, isTrialExpired } from '../_lib/checkAllowedUser'

interface SearchRequest {
  query: string
  maxResults?: number
}

interface NormalisedResult {
  title: string
  url: string
  snippet: string
}

interface SearchResponse {
  provider: 'linkup' | 'brave'
  results: NormalisedResult[]
  query: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Auth obligatoire — anti-relais anonyme (RÈGLE 6 / CRIT-4).
  const user = await checkAllowedUserPeek(request, env)
  if (!user || isTrialExpired(user)) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { query, maxResults = 5 } = (await request.json()) as SearchRequest
  if (!query || typeof query !== 'string' || query.length < 2) {
    return Response.json({ error: 'Query missing or too short' }, { status: 400 })
  }

  const provider: 'linkup' | 'brave' = (env.SEARCH_PROVIDER as 'linkup' | 'brave') || 'linkup'

  try {
    let results: NormalisedResult[]
    if (provider === 'brave') {
      results = await searchBrave(env.BRAVE_SEARCH_API_KEY, query, maxResults)
    } else {
      results = await searchLinkup(env.LINKUP_API_KEY, query, maxResults)
    }
    const response: SearchResponse = { provider, results, query }
    return Response.json(response, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        // Indique au client quel provider a répondu — récupéré côté UI
        // pour afficher "🔍 Linkup" sous le sélecteur.
        'x-search-provider': provider,
      },
    })
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : 'Search failed',
        provider,
      },
      { status: 502 }
    )
  }
}

// Linkup — API LLM-native, hostée EU (france). Format:
// POST https://api.linkup.so/v1/search { q, depth: 'standard'|'deep', outputType: 'searchResults' }
// Auth : Bearer token
async function searchLinkup(
  apiKey: string | undefined,
  query: string,
  maxResults: number
): Promise<NormalisedResult[]> {
  if (!apiKey) throw new Error('LINKUP_API_KEY not configured')

  const res = await fetch('https://api.linkup.so/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      q: query,
      depth: 'standard',
      outputType: 'searchResults',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Linkup ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { results?: Array<{ name?: string; url?: string; content?: string }> }
  return (data.results || []).slice(0, maxResults).map((r) => ({
    title: r.name || '',
    url: r.url || '',
    snippet: r.content || '',
  }))
}

// Brave Search — API SERP indépendante. Format:
// GET https://api.search.brave.com/res/v1/web/search?q=...&count=...
// Auth : header X-Subscription-Token
async function searchBrave(
  apiKey: string | undefined,
  query: string,
  maxResults: number
): Promise<NormalisedResult[]> {
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY not configured')

  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(maxResults))

  const res = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Brave ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } }
  return (data.web?.results || []).slice(0, maxResults).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || '',
  }))
}
