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

  it('conserve une URL exacte et pertinente issue de la recherche et une URL fournie par l’utilisateur', () => {
    setSearchContext({
      provider: 'Google Search',
      query: 'marchés européens',
      results: [{
        title: 'Analyse des marchés européens',
        url: 'https://source.example/marches-europeens',
        snippet: 'Les marchés européens progressent avec le recul du pétrole.',
      }],
    }, 'conv-a')

    const prepared = prepareAssistantContent(
      'Compare les marchés européens avec https://user.example/page',
      [
        '[Analyse](https://source.example/marches-europeens)',
        '[Lien utilisateur](https://user.example/page)',
      ].join('\n'),
      'conv-a',
    )

    expect(prepared.removedLinks).toBe(0)
    expect(prepared.content).toContain('[Analyse](https://source.example/marches-europeens)')
    expect(prepared.content).toContain('[Lien utilisateur](https://user.example/page)')
  })

  it('rejette les sources citées mais hors sujet observées sur Android', () => {
    const content = [
      'Les places financières européennes progressent légèrement.',
      'Le recul du prix du pétrole soutient les marchés, tandis que les prix de l’énergie restent surveillés.',
      'Voir aussi [Météo France](https://meteofrance.com/previsions-meteo-france).',
    ].join(' ')
    setSearchContext({
      provider: 'Google Search',
      query: 'actualités du jour',
      results: [
        {
          title: 'meteofrance.com',
          url: 'https://meteofrance.com/previsions-meteo-france',
          snippet: 'Prévisions météo, pluie et températures pour les prochains jours.',
          supportText: content,
          cited: true,
        },
        {
          title: 'dailymotion.com',
          url: 'https://www.dailymotion.com/fr',
          snippet: 'Vidéos et divertissement en streaming.',
          supportText: content,
          cited: true,
        },
        {
          title: 'visit-corsica.com',
          url: 'https://www.visit-corsica.com/',
          snippet: 'Préparer un séjour et découvrir les plages de Corse.',
          supportText: content,
          cited: true,
        },
        {
          title: 'lagazettefrance.fr',
          url: 'https://www.lagazettefrance.fr/',
          snippet: 'Vie locale et annonces des collectivités territoriales.',
          supportText: content,
          cited: true,
        },
        {
          title: 'selectra.info',
          url: 'https://selectra.info/energie',
          snippet: 'Comparer les fournisseurs et les contrats de gaz domestique.',
          supportText: content,
          cited: true,
        },
      ],
    }, 'conv-a')

    const prepared = prepareAssistantContent(
      'Que se passe-t-il aujourd’hui sur les marchés financiers européens ?',
      content,
      'conv-a',
    )

    expect(prepared.content).not.toContain('Sources retrouvées par la recherche')
    expect(prepared.content).not.toContain('(https://meteofrance.com')
    expect(prepared.content).toContain('lien non vérifié retiré')
    expect(prepared.content).not.toContain('selectra.info')
    expect(prepared.appendedSources).toBe(0)
    expect(prepared.searchContext?.results).toHaveLength(5)
  })

  it('affiche une citation structurée seulement quand son extrait recoupe le sujet', () => {
    const supportedSentence =
      'Le recul du pétrole soutient les places financières européennes.'
    setSearchContext({
      provider: 'Anthropic Web Search',
      query: 'marchés européens pétrole',
      results: [{
        title: 'Les marchés européens progressent avec le recul du pétrole',
        url: 'https://reuters.example/marches/europe-petrole',
        snippet: 'Les places financières européennes progressent tandis que le pétrole recule.',
        supportText: supportedSentence,
        cited: true,
      }],
    }, 'conv-a')

    const prepared = prepareAssistantContent(
      'Que font les marchés européens ?',
      supportedSentence,
      'conv-a',
    )

    expect(prepared.content).toContain('Sources retrouvées par la recherche')
    expect(prepared.content).toContain(
      '[Les marchés européens progressent avec le recul du pétrole](https://reuters.example/marches/europe-petrole)',
    )
    expect(prepared.appendedSources).toBe(1)
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
            segment: { text: 'Le prix actuel est de 42 €.' },
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
        supportText: 'Le prix actuel est de 42 €.',
        cited: true,
      }],
    })
  })
})
