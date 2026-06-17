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
import {
  consumeOwnerApiQuota,
  ownerApiLimitResponse,
  planSubjectToOwnerApiCap,
} from '../_lib/freeQuota'

interface SearchRequest {
  query: string
  maxResults?: number
  // Liste optionnelle de domaines à interroger SÉPARÉMENT (ex:
  // ["bricodepot.fr", "cedeo.fr"]). Quand fournie, le proxy fait un appel
  // par source avec l'opérateur `site:`, agrège, et retourne les résultats
  // organisés par source — pour les requêtes de comparaison où une
  // synthèse globale perd l'attribution. C'est le fix Option A après que
  // Mistral ait halluciné en mélangeant les revendeurs sur un comparatif
  // PAC (mai 2026).
  sources?: string[]
}

interface NormalisedResult {
  title: string
  url: string
  snippet: string
}

// Réponse pour 1 source unique (cas standard, ou Brave).
interface SingleSourceResponse {
  provider: 'linkup' | 'brave'
  // Réponse synthétisée par le provider (Linkup uniquement). Quand présent,
  // c'est la donnée la plus fiable à injecter dans le contexte Mistral —
  // pas besoin de re-parser les snippets bruts qui amènent des hallucinations.
  answer?: string
  results: NormalisedResult[]
  query: string
}

// Réponse multi-source (Option A). Chaque source est une clé du dict avec
// SA propre answer + sources, garantissant l'attribution per-source.
interface MultiSourceResponse {
  provider: 'linkup' | 'brave'
  query: string
  bySource: Record<string, { answer?: string; results: NormalisedResult[] }>
}

type SearchResponse = SingleSourceResponse | MultiSourceResponse

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Auth obligatoire — anti-relais anonyme (RÈGLE 6 / CRIT-4).
  const user = await checkAllowedUserPeek(request, env)
  if (!user || isTrialExpired(user)) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { query, maxResults = 5, sources } = (await request.json()) as SearchRequest
  if (!query || typeof query !== 'string' || query.length < 2) {
    return Response.json({ error: 'Query missing or too short' }, { status: 400 })
  }

  // Domaines nettoyés (mode multi-source) — calculés AVANT le cap pour compter
  // le nombre d'appels Linkup RÉELS (1 par source), pas 1 par requête HTTP :
  // sinon un user consommerait jusqu'à 6× le budget Linkup sous 1 unité de cap.
  const cleanedSources = (sources ?? [])
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s))
    .slice(0, 6) // cap à 6 sources max pour éviter d'exploser le quota Linkup
  const isMultiSource = cleanedSources.length > 0
  const providerCalls = isMultiSource ? cleanedSources.length : 1

  // Cap journalier par email sur la clé de recherche PAYANTE du owner
  // (Linkup/Brave), appliqué aux seuls plans non-payants. Compté en appels
  // provider réels. Le filet contre l'abus multi-comptes est le plafond DUR
  // côté provider (budget Linkup) — cf. docs ops.
  if (planSubjectToOwnerApiCap(user.planType)) {
    const cap = await consumeOwnerApiQuota(env, user.email, 'web-search', providerCalls)
    if (!cap.allowed) return ownerApiLimitResponse('web-search', cap.limit)
  }

  const provider: 'linkup' | 'brave' = (env.SEARCH_PROVIDER as 'linkup' | 'brave') || 'linkup'

  try {
    // Mode multi-source (Option A) — appels parallèles avec opérateur site:
    // pour chaque domaine demandé. Garantit une réponse par source distincte
    // au lieu d'une synthèse globale qui mélange l'attribution.
    if (isMultiSource) {
      const perSource = await Promise.all(
        cleanedSources.map(async (source) => {
          const sourcedQuery = `${query} site:${source}`
          try {
            const linkup = await searchLinkup(env.LINKUP_API_KEY, sourcedQuery, maxResults)
            return { source, answer: linkup.answer, results: linkup.results }
          } catch (err) {
            // Idem N-2 : on n'embarque pas le message d'erreur du provider dans
            // la réponse (il n'était de toute façon pas propagé à bySource). Le
            // détail est loggé côté serveur uniquement.
            console.error('[search/web] source failed', source, err)
            return { source, answer: undefined, results: [] }
          }
        })
      )

      const bySource: MultiSourceResponse['bySource'] = {}
      for (const r of perSource) {
        bySource[r.source] = { answer: r.answer, results: r.results }
      }
      const response: MultiSourceResponse = { provider, query, bySource }
      return Response.json(response, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-search-provider': provider,
          'x-search-mode': 'multi-source',
        },
      })
    }

    // Mode standard — une seule recherche
    let answer: string | undefined
    let results: NormalisedResult[]
    if (provider === 'brave') {
      results = await searchBrave(env.BRAVE_SEARCH_API_KEY, query, maxResults)
    } else {
      const linkupResp = await searchLinkup(env.LINKUP_API_KEY, query, maxResults)
      answer = linkupResp.answer
      results = linkupResp.results
    }
    const response: SingleSourceResponse = { provider, answer, results, query }
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
    // N-2 — ne pas exposer au client le status/body du provider (Linkup/Brave).
    // Ce sont des détails internes (codes d'erreur, structure de réponse, état
    // du compte search du owner). Le détail reste côté serveur pour le debug ;
    // le client ne reçoit qu'un message générique indistinguable.
    console.error('[search/web] provider error', provider, err)
    return Response.json({ error: 'Search failed' }, { status: 502 })
  }
}

// Linkup — API LLM-native, hostée EU (france). Mode 'sourcedAnswer' :
// Linkup synthétise la réponse à partir des sources et nous renvoie une
// réponse pré-mâchée + les sources. Bien plus fiable que les search results
// bruts pour éviter les hallucinations Mistral (problème vu sur le score
// d'un match OL-Rennes où Mistral mélangeait les snippets).
//
// Format réponse :
//   { answer: "OL mène 2-1 à la mi-temps...", sources: [{name, url, snippet}] }
async function searchLinkup(
  apiKey: string | undefined,
  query: string,
  maxResults: number
): Promise<{ answer?: string; results: NormalisedResult[] }> {
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
      outputType: 'sourcedAnswer',
      includeImages: false,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Linkup ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    answer?: string
    sources?: Array<{ name?: string; url?: string; snippet?: string }>
  }
  return {
    answer: data.answer,
    results: (data.sources || []).slice(0, maxResults).map((r) => ({
      title: r.name || '',
      url: r.url || '',
      snippet: r.snippet || '',
    })),
  }
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
