// Tool web_search exécuté CÔTÉ CLIENT pour les providers sans recherche
// native (Mistral, OpenAI). Extrait de mistralClient.ts (où il est né pour
// l'audit Mistral de juin 2026) au moment de donner les mêmes outils à
// OpenAI — le comportement est identique à l'original, seul le nom change
// (executeMistralWebSearch → executeClientWebSearch).
//
// Appelle le proxy /api/search/web qui route vers Linkup (par défaut) ou
// Brave selon la variable env SEARCH_PROVIDER côté Cloudflare. Retourne un
// texte formaté que le modèle injecte dans son prochain message comme
// contexte.

import { apiUrl } from '../apiBase'
import { getValidAccessToken } from '../googleAuth'
import { setSearchContext } from '../factChecker'

// Bornes d'injection des résultats de recherche dans le contexte du modèle.
// Sans cap, une sourcedAnswer Linkup de plusieurs kB entrait entière à
// chaque tour → contexte qui enfle → le modèle « comble » par extrapolation
// sur les conversations longues (audit Mistral 11 juin 2026, cause n°3a).
const MAX_ANSWER_CHARS = 2000
const MAX_SNIPPET_CHARS = 600

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + ' […]' : text
}

// Définition OpenAI-format du tool, partagée Mistral/OpenAI. Ni Mistral ni
// l'API Chat Completions d'OpenAI (telle qu'utilisée par Arty) n'ont de
// recherche web native — on leur fournit ce tool qui appelle notre proxy.
export const WEB_SEARCH_TOOL_DEF = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: `Recherche web en temps réel. OBLIGATOIRE pour toute donnée récente (actualité, prix, événements, sorties produits, scores sportifs, météo, données 2025+).

Pour les COMPARAISONS multi-sites/multi-revendeurs (ex: "compare prix X chez Brico Dépôt, Cedeo, Mr Bricolage"), tu DOIS utiliser le paramètre 'sources' avec la liste des domaines (ex: ["bricodepot.fr", "cedeo.fr", "mrbricolage.fr"]). Le serveur fait UN APPEL PAR SOURCE et te retourne les résultats organisés par source — l'attribution est ainsi garantie. NE FAIS JAMAIS une seule recherche générique pour comparer plusieurs sources : tu mélangeras inévitablement les données.`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'La requête à rechercher (ex: "prix Daikin Altherma 3"). PAS d\'opérateur site: ici — utilise le paramètre `sources` à la place.' },
        maxResults: { type: 'integer', description: 'Nombre max de résultats par source (défaut 5, max 10)' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'OBLIGATOIRE pour les comparaisons multi-sites : liste des domaines à interroger séparément. Ex: ["bricodepot.fr", "cedeo.fr"]. Le serveur fait un appel par source. Cap à 6 sources max.',
        },
      },
      required: ['query'],
    },
  },
}

export async function executeClientWebSearch(
  args: Record<string, unknown>,
  contextScope?: string,
  externalSignal?: AbortSignal,
): Promise<{ result: string }> {
  const query = String(args.query || '').trim()
  if (!query) return { result: 'Erreur: paramètre `query` manquant.' }
  // Défaut 5 → 8 : sur les requêtes type rapport/comparatif, 5 snippets ne
  // suffisaient pas face au corpus Gemini/Claude (audit, cause n°2a).
  const maxResults = typeof args.maxResults === 'number' ? Math.min(10, Math.max(1, args.maxResults)) : 8
  const sources = Array.isArray(args.sources)
    ? (args.sources as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 6)
    : undefined

  const googleToken = await getValidAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Le proxy /api/search/web authentifie via x-google-token (checkAllowedUser).
  // PAS d'Authorization ici : ce header n'est pas une clé provider, juste le
  // token Google — l'envoyer en double était redondant et trompeur.
  if (googleToken) headers['x-google-token'] = googleToken

  // CRIT-5 — Timeout 30s sur web_search pour éviter les blocages
  // sur cold-start Cloudflare ou réseau flaky. Composé avec le signal externe
  // (Stop utilisateur) quand l'appelant le fournit.
  const searchCtrl = new AbortController()
  const searchTimeoutId = setTimeout(() => searchCtrl.abort(new DOMException('Timeout', 'AbortError')), 30_000)
  const onExternalAbort = () => searchCtrl.abort(externalSignal?.reason ?? new DOMException('Aborted', 'AbortError'))
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  let response: Response
  try {
    response = await fetch(apiUrl('/api/search/web'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, maxResults, ...(sources ? { sources } : {}) }),
      signal: searchCtrl.signal,
    })
  } catch (err) {
    return { result: `Erreur réseau de recherche : ${err instanceof Error ? err.message : 'inconnue'}` }
  } finally {
    clearTimeout(searchTimeoutId)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return { result: `Recherche échouée (${response.status}) : ${body.slice(0, 200)}` }
  }

  const data = (await response.json()) as
    | {
        provider: string
        answer?: string
        results: Array<{ title: string; url: string; snippet: string }>
      }
    | {
        provider: string
        bySource: Record<string, { answer?: string; results: Array<{ title: string; url: string; snippet: string }> }>
      }

  // Notifie l'UI du provider qui a répondu (Linkup ou Brave).
  try {
    window.dispatchEvent(new CustomEvent('arty-search-used', { detail: { provider: data.provider } }))
  } catch {}

  // Capture le contexte de recherche pour que le fact-checker puisse
  // VRAIMENT vérifier les claims contre les sources (v2 du fact-checker).
  // Sans ça, Haiku/Sonnet ne peuvent que se reposer sur leur cutoff de
  // connaissance — incapables de valider les claims actualité.
  if ('bySource' in data) {
    setSearchContext({
      provider: data.provider,
      query,
      bySource: data.bySource,
    }, contextScope)
  } else {
    setSearchContext({
      provider: data.provider,
      query,
      answer: data.answer,
      results: data.results,
    }, contextScope)
  }

  // Multi-source response (Option A) : retour structuré par source avec
  // attribution garantie. On formate de façon à ce que le modèle voie
  // clairement "voici ce qu'il y a chez X / chez Y / chez Z" sans risque
  // de mélanger.
  if ('bySource' in data) {
    const sections: string[] = []
    for (const [source, entry] of Object.entries(data.bySource)) {
      if (entry.answer) {
        sections.push(`### Chez ${source}\n${clip(entry.answer, MAX_ANSWER_CHARS)}`)
      } else if (entry.results.length > 0) {
        const refs = entry.results
          .map((r) => `- ${r.title}\n  ${clip(r.snippet, MAX_SNIPPET_CHARS)}\n  Source: ${r.url}`)
          .join('\n')
        sections.push(`### Chez ${source}\n${refs}`)
      } else {
        sections.push(`### Chez ${source}\nAucun résultat pertinent.`)
      }
    }
    return {
      result:
        `Recherche multi-source (${data.provider}) pour "${query}" :\n\n${sections.join('\n\n')}\n\n` +
        `IMPORTANT : chaque section ci-dessus correspond À UNE SOURCE PRÉCISE. NE MÉLANGE JAMAIS les données entre sources. Si une source dit X et une autre Y, mentionne les deux. Cite via [Brico Dépôt: prix X], [Cedeo: prix Y], etc.`,
    }
  }

  // Single-source — Linkup `sourcedAnswer` ou Brave snippets bruts.
  const sourcesBlock = data.results && data.results.length > 0
    ? '\n\nSources:\n' + data.results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}`).join('\n')
    : ''

  if (data.answer) {
    return {
      result:
        `Réponse vérifiée (${data.provider}) à "${query}" :\n\n${clip(data.answer, MAX_ANSWER_CHARS)}\n\n` +
        `IMPORTANT : reprends ces données telles quelles, ne devine pas, cite les sources via [1], [2], etc.${sourcesBlock}`,
    }
  }

  if (!data.results || data.results.length === 0) {
    return { result: `Aucun résultat trouvé pour "${query}".` }
  }
  const formatted = data.results
    .map((r, i) => `[${i + 1}] **${r.title}**\n${clip(r.snippet, MAX_SNIPPET_CHARS)}\nSource: ${r.url}`)
    .join('\n\n')
  return {
    result:
      `Résultats de recherche (${data.provider}) pour "${query}" :\n\n${formatted}\n\n` +
      `IMPORTANT : ne devine pas, ne mélange pas les sources, cite via [1], [2], etc.`,
  }
}
