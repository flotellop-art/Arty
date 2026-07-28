import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSearchContext,
  getSearchContext,
  prepareAssistantContent,
  setSearchContext,
} from '../../services/factChecker'
import { extractGeminiSearchContext } from '../../services/geminiClient'

describe('provenance des sources par conversation', () => {
  beforeEach(() => {
    clearSearchContext('conv-a')
    clearSearchContext('conv-b')
  })

  it('isole les recherches de deux streams concurrents', () => {
    setSearchContext({
      provider: 'Linkup',
      query: 'alpha',
      results: [{ title: 'Alpha', url: 'https://alpha.example/page', snippet: 'A' }],
    }, 'conv-a')
    setSearchContext({
      provider: 'Google Search',
      query: 'beta',
      results: [{ title: 'Beta', url: 'https://beta.example/page', snippet: 'B' }],
    }, 'conv-b')

    expect(getSearchContext('conv-a')?.results?.[0]?.url).toContain('alpha.example')
    expect(getSearchContext('conv-b')?.results?.[0]?.url).toContain('beta.example')
  })

  it('fusionne plusieurs recherches du même tour sans perdre les premières sources', () => {
    setSearchContext({
      provider: 'Linkup',
      query: 'première',
      results: [{ title: 'Un', url: 'https://sources.example/un', snippet: '' }],
    }, 'conv-a')
    setSearchContext({
      provider: 'Linkup',
      query: 'seconde',
      results: [{ title: 'Deux', url: 'https://sources.example/deux', snippet: '' }],
    }, 'conv-a')

    expect(getSearchContext('conv-a')?.results?.map((s) => s.url)).toEqual([
      'https://sources.example/un',
      'https://sources.example/deux',
    ])
  })
})

describe('prepareAssistantContent', () => {
  beforeEach(() => clearSearchContext('conv-a'))

  it('retire un lien halluciné et ajoute la vraie URL structurée de la recherche', () => {
    setSearchContext({
      provider: 'Linkup',
      query: 'documentation officielle',
      results: [{
        title: 'Documentation officielle',
        url: 'https://docs.example.com/guide',
        snippet: 'Guide officiel',
        cited: true,
      }],
    }, 'conv-a')

    const prepared = prepareAssistantContent(
      'Donne-moi la documentation',
      'Voici le [guide](https://docs.example.com/guide-invente).',
      'conv-a',
    )

    expect(prepared.content).not.toContain('(https://docs.example.com/guide-invente)')
    expect(prepared.content).toContain('lien non vérifié retiré')
    expect(prepared.content).toContain(
      '[Documentation officielle](https://docs.example.com/guide)',
    )
    expect(prepared.removedLinks).toBeGreaterThan(0)
    expect(getSearchContext('conv-a')).toBeNull()
  })

  it('n’affiche pas le réservoir brut de résultats non cités', () => {
    setSearchContext({
      provider: 'Anthropic Web Search',
      query: 'rumeurs mercato football',
      results: [
        { title: 'selectra.info', url: 'https://selectra.info/article', snippet: '' },
        { title: 'alertes-meteo.com', url: 'https://alertes-meteo.com/article', snippet: '' },
        { title: 'legifrance.gouv.fr', url: 'https://legifrance.gouv.fr/article', snippet: '' },
      ],
    }, 'conv-a')

    const prepared = prepareAssistantContent(
      'Quelles sont les dernières rumeurs du mercato ?',
      'John Stones intéresse plusieurs clubs européens.',
      'conv-a',
    )

    expect(prepared.content).not.toContain('Sources retrouvées par la recherche')
    expect(prepared.content).not.toContain('selectra.info')
    expect(prepared.appendedSources).toBe(0)
    // Le pool brut reste fourni au fact-checker, il n'est simplement plus
    // présenté à l'utilisateur comme une bibliographie fiable.
    expect(prepared.searchContext?.results).toHaveLength(3)
  })

  it('conserve une URL exacte issue de la recherche et une URL fournie par l’utilisateur', () => {
    setSearchContext({
      provider: 'Google Search',
      query: 'source',
      results: [{ title: 'Source', url: 'https://source.example/article', snippet: '' }],
    }, 'conv-a')

    const prepared = prepareAssistantContent(
      'Compare avec https://user.example/page',
      [
        '[Source](https://source.example/article)',
        '[Lien utilisateur](https://user.example/page)',
      ].join('\n'),
      'conv-a',
    )

    expect(prepared.removedLinks).toBe(0)
    expect(prepared.content).toContain('[Source](https://source.example/article)')
    expect(prepared.content).toContain('[Lien utilisateur](https://user.example/page)')
  })

  it('neutralise aussi les ancres HTML, boutons et URL nues sans provenance', () => {
    const prepared = prepareAssistantContent(
      'Ouvre les références',
      [
        '<a href="https://dead.example/a">article</a>',
        '<button data-action="link" data-url="https://dead.example/b">Ouvrir</button>',
        'https://dead.example/c',
      ].join('\n'),
      'conv-a',
    )

    expect(prepared.content).not.toContain('href="https://dead.example/a"')
    expect(prepared.content).not.toContain('data-url="https://dead.example/b"')
    expect(prepared.content).toContain('`https://dead.example/c`')
  })

  it('conserve les deep-links internes Arty', () => {
    const prepared = prepareAssistantContent(
      'Montre le rapport',
      '[Rapport](https://tryarty.com/report/abc)',
      'conv-a',
    )
    expect(prepared.content).toContain('(https://tryarty.com/report/abc)')
    expect(prepared.removedLinks).toBe(0)
  })

  it('ne modifie jamais les URL présentes dans du code', () => {
    const content = [
      '```ts',
      "fetch('https://api.example.com/v1/items')",
      '```',
      '',
      '`https://inline.example/path`',
    ].join('\n')
    const prepared = prepareAssistantContent('Explique ce code', content, 'conv-a')

    expect(prepared.content).toBe(content)
    expect(prepared.removedLinks).toBe(0)
  })
})

describe('métadonnées Google Search', () => {
  it('extrait les groundingChunks officiels pour le fact-check et les liens', () => {
    const context = extractGeminiSearchContext({
      candidates: [{
        groundingMetadata: {
          webSearchQueries: ['prix actuel'],
          groundingChunks: [{
            web: {
              uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
              title: 'example.com',
            },
          }],
          groundingSupports: [{
            groundingChunkIndices: [0],
          }],
        },
      }],
    })

    expect(context).toEqual({
      provider: 'Google Search',
      query: 'prix actuel',
      results: [{
        title: 'example.com',
        url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
        snippet: '',
        cited: true,
      }],
    })
  })
})
