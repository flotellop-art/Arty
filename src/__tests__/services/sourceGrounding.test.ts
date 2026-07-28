import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSearchContext,
  getSearchContext,
  needsLinkRecovery,
  prepareAssistantContent,
  recoverAssistantLinks,
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

  it('remplace un lien halluciné par la vraie URL structurée de la recherche', () => {
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
    expect(prepared.content).toContain(
      '[guide](https://docs.example.com/guide)',
    )
    expect(prepared.removedLinks).toBe(0)
    expect(prepared.replacedLinks).toBe(1)
    expect(prepared.appendedSources).toBe(0)
    expect(getSearchContext('conv-a')).toBeNull()
  })

  it('recherche et remplace trois liens morts par trois pages directes du bon domaine', async () => {
    const question = [
      'Donne-moi trois liens officiels sur le lancement du télescope James-Webb,',
      'un de la NASA, un de l’ESA et un d’Arianespace.',
    ].join(' ')
    const content = [
      '- [NASA : lancement de Webb](https://www.nasa.gov/communique-invente)',
      '- [ESA : décollage de Webb](https://www.esa.int/page-inventee)',
      '- [Arianespace : vol VA256](https://www.arianespace.com/mission-inventee)',
    ].join('\n')
    const initial = prepareAssistantContent(question, content, 'conv-a')
    expect(initial.removedLinks).toBe(3)
    expect(needsLinkRecovery(question, initial)).toBe(true)

    let requestedDomains: string[] = []
    const recovered = await recoverAssistantLinks(
      question,
      content,
      initial,
      async (_query, _maxResults, domains) => {
        requestedDomains = domains
        return {
          provider: 'Linkup link recovery',
          query: question,
          results: [
            {
              title: 'NASA launches James Webb Space Telescope',
              url: 'https://www.nasa.gov/news-release/nasa-launches-james-webb-space-telescope/',
              snippet: 'Webb launched aboard Ariane 5 on December 25, 2021.',
              cited: true,
              recovered: true,
            },
            {
              title: 'NASA image of the James Webb launch',
              url: 'https://www.nasa.gov/image-article/james-webb-launch/',
              snippet: 'The image shows the ESA and Arianespace launch of Webb.',
              cited: true,
              recovered: true,
            },
            {
              title: 'Webb liftoff on Ariane 5',
              url: 'https://www.esa.int/Science_Exploration/Space_Science/Webb/Webb_liftoff',
              snippet: 'ESA confirms the successful launch of the James Webb Space Telescope.',
              cited: true,
              recovered: true,
            },
            {
              title: 'Ariane Flight VA256',
              url: 'https://newsroom.arianespace.com/ariane-flight-va256/',
              snippet: 'Arianespace launched Webb on Ariane 5 flight VA256.',
              cited: true,
              recovered: true,
            },
          ],
        }
      },
    )

    expect(requestedDomains).toEqual([
      'nasa.gov',
      'esa.int',
      'arianespace.com',
    ])
    expect(recovered.content).toContain(
      '(https://www.nasa.gov/news-release/nasa-launches-james-webb-space-telescope/)',
    )
    expect(recovered.content).toContain(
      '(https://www.esa.int/Science_Exploration/Space_Science/Webb/Webb_liftoff)',
    )
    expect(recovered.content).toContain(
      '(https://newsroom.arianespace.com/ariane-flight-va256/)',
    )
    expect(recovered.content).not.toContain('lien non vérifié retiré')
    expect(recovered.removedLinks).toBe(0)
    expect(recovered.replacedLinks).toBe(3)
  })

  it('remplace aussi un redirect Google opaque par une URL directe récupérée', async () => {
    const question = 'Donne le lien officiel Arianespace du vol VA256.'
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque'
    setSearchContext({
      provider: 'Google Search',
      query: question,
      results: [{
        title: 'Arianespace',
        url: redirect,
        snippet: '',
        supportText: 'Arianespace, vol VA256',
        cited: true,
      }],
    }, 'conv-a')
    const content = `[Arianespace, vol VA256](${redirect})`
    const initial = prepareAssistantContent(question, content, 'conv-a')

    const recovered = await recoverAssistantLinks(
      question,
      content,
      initial,
      async () => ({
        provider: 'Linkup link recovery',
        query: question,
        results: [{
          title: 'Ariane Flight VA256',
          url: 'https://newsroom.arianespace.com/ariane-flight-va256/',
          snippet: 'Arianespace flight VA256 launched the James Webb Space Telescope.',
          cited: true,
          recovered: true,
        }],
      }),
    )

    expect(recovered.content).toContain(
      '[Arianespace, vol VA256](https://newsroom.arianespace.com/ariane-flight-va256/)',
    )
    expect(recovered.content).not.toContain('grounding-api-redirect')
    expect(recovered.replacedLinks).toBe(1)
  })

  it('complète une récupération par domaine pour remplacer le dernier redirect opaque', async () => {
    const question = 'Donne trois liens officiels NASA, ESA et Arianespace sur James-Webb.'
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/arianespace'
    setSearchContext({
      provider: 'Google Search',
      query: question,
      results: [{
        title: 'Arianespace',
        url: redirect,
        snippet: '',
        supportText: 'Arianespace a lancé James-Webb avec le vol VA256.',
        cited: true,
      }],
    }, 'conv-a')
    const content = [
      '[NASA, lancement de Webb](https://www.nasa.gov/page-inventee)',
      '[ESA, lancement de Webb](https://www.esa.int/page-inventee)',
      `[Arianespace, vol VA256](${redirect})`,
    ].join('\n')
    const initial = prepareAssistantContent(question, content, 'conv-a')
    const calls: string[][] = []
    const redirectCalls: string[][] = []

    const recovered = await recoverAssistantLinks(
      question,
      content,
      initial,
      async (_query, _maxResults, domains, redirects) => {
        calls.push(domains)
        redirectCalls.push(redirects)
        if (domains.length > 0) {
          return {
            provider: 'Linkup link recovery',
            query: question,
            results: [
              {
                title: 'NASA launches James Webb',
                url: 'https://www.nasa.gov/news-release/nasa-launches-james-webb/',
                snippet: 'NASA confirms the launch of James-Webb.',
                cited: true,
                recovered: true,
              },
              {
                title: 'ESA Webb liftoff',
                url: 'https://www.esa.int/Science_Exploration/Webb_liftoff',
                snippet: 'ESA confirms the launch of James-Webb.',
                cited: true,
                recovered: true,
              },
            ],
          }
        }
        return {
          provider: 'Linkup link recovery',
          query: question,
          results: [{
            title: 'Ariane Flight VA256',
            url: 'https://newsroom.arianespace.com/ariane-flight-va256/',
            snippet: 'Arianespace launched James-Webb on flight VA256.',
            cited: true,
            recovered: true,
          }],
        }
      },
    )

    expect(calls).toEqual([
      ['nasa.gov', 'esa.int'],
      [],
    ])
    expect(redirectCalls).toEqual([[redirect], [redirect]])
    expect(recovered.content).not.toContain('grounding-api-redirect')
    expect(recovered.content).toContain('newsroom.arianespace.com/ariane-flight-va256')
    expect(recovered.removedLinks).toBe(0)
    expect(recovered.replacedLinks).toBe(3)
  })

  it('reconnait le nom developpe de ESA dans un redirect opaque', async () => {
    const question = 'Donne le lien officiel de Agence spatiale europeenne.'
    const redirect =
      'https://vertexaisearch.cloud.google.com/grounding-api-redirect/esa'
    const content = `[Agence spatiale europeenne](${redirect})`
    const initial = prepareAssistantContent(question, content, 'conv-a')

    const recovered = await recoverAssistantLinks(
      question,
      content,
      initial,
      async () => ({
        provider: 'Linkup link recovery',
        query: question,
        results: [{
          title: 'ESA',
          url: 'https://www.esa.int/Science_Exploration/Webb_liftoff',
          snippet: 'Agence spatiale europeenne, ESA, confirme le lancement.',
          cited: true,
          recovered: true,
        }],
      }),
    )

    expect(recovered.content).toContain(
      '[Agence spatiale europeenne](https://www.esa.int/Science_Exploration/Webb_liftoff)',
    )
    expect(recovered.content).not.toContain('grounding-api-redirect')
  })

  it('utilise le nom de institution avant le lien pour attribuer chaque redirect', async () => {
    const question =
      'Donne trois liens officiels NASA, ESA et Arianespace sur le lancement de James-Webb.'
    const content = [
      '- **NASA** : [Webb launch](https://vertexaisearch.cloud.google.com/grounding-api-redirect/nasa)',
      '- **ESA** : [Webb liftoff on Ariane 5](https://vertexaisearch.cloud.google.com/grounding-api-redirect/esa)',
      '- **Arianespace** : [Ariane Flight VA256](https://vertexaisearch.cloud.google.com/grounding-api-redirect/arianespace)',
    ].join('\n')
    const initial = prepareAssistantContent(question, content, 'conv-a')

    const recovered = await recoverAssistantLinks(
      question,
      content,
      initial,
      async () => ({
        provider: 'Linkup link recovery',
        query: question,
        results: [
          {
            title: 'Ariane Flight VA256',
            url: 'https://newsroom.arianespace.com/ariane-flight-va256/',
            snippet: 'Arianespace launched James-Webb.',
            cited: true,
            recovered: true,
          },
          {
            title: 'ESA',
            url: 'https://www.esa.int/Science_Exploration/Space_Science/Webb_liftoff',
            snippet: 'ESA confirms the James-Webb launch.',
            cited: true,
            recovered: true,
          },
          {
            title: 'NASA',
            url: 'https://www.nasa.gov/news-release/james-webb-launch/',
            snippet: 'NASA confirms the James-Webb launch.',
            cited: true,
            recovered: true,
          },
        ],
      }),
    )

    expect(recovered.content).toContain(
      '**NASA** : [Webb launch](https://www.nasa.gov/news-release/james-webb-launch/)',
    )
    expect(recovered.content).toContain(
      '**ESA** : [Webb liftoff on Ariane 5](https://www.esa.int/Science_Exploration/Space_Science/Webb_liftoff)',
    )
    expect(recovered.content).toContain(
      '**Arianespace** : [Ariane Flight VA256](https://newsroom.arianespace.com/ariane-flight-va256/)',
    )
    expect(recovered.content).not.toContain('grounding-api-redirect')
  })

  it('ne recherche pas trois liens quand la question en demande un seul', () => {
    setSearchContext({
      provider: 'Linkup',
      query: 'documentation officielle',
      results: [{
        title: 'Documentation officielle',
        url: 'https://docs.example.com/guide',
        snippet: 'Guide officiel du produit.',
      }],
    }, 'conv-a')
    const prepared = prepareAssistantContent(
      'Donne le lien de la documentation officielle.',
      '[Documentation](https://docs.example.com/guide)',
      'conv-a',
    )

    expect(needsLinkRecovery('Donne le lien de la documentation officielle.', prepared)).toBe(false)
  })

  it('ne confond pas le code source avec une demande de sources web', () => {
    const prepared = prepareAssistantContent(
      'Explique ce code source TypeScript.',
      'Ce code transforme une liste puis retourne le résultat calculé.',
      'conv-a',
    )

    expect(needsLinkRecovery('Explique ce code source TypeScript.', prepared)).toBe(false)
  })

  it('garde les liens neutralisés si la recherche de remplacement échoue', async () => {
    const question = 'Donne trois liens officiels.'
    const content = '[Source](https://dead.example/page)'
    const initial = prepareAssistantContent(question, content, 'conv-a')
    const recovered = await recoverAssistantLinks(
      question,
      content,
      initial,
      async () => null,
    )

    expect(recovered).toEqual(initial)
    expect(recovered.content).toContain('lien non vérifié retiré')
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
