// Refonte routage (étape 2) — tests du moteur unifié resolveRoute.
// La PARITÉ avec l'ancien detectProvider est déjà verrouillée par
// aiRouter.test.ts (121 cas passent par le wrapper detectProvider →
// resolveRoute). Ici : ce que le moteur apporte en PLUS — orchestration
// euOnly/fichiers (ex-useConversation, jamais testée), raisons, overrides,
// et sous-décision Claude calculée sur le texte original.
import { describe, expect, it } from 'vitest'
import { canExecuteRoute, resolveRoute } from '../../services/router/resolveRoute'
import type { PlanContext, ProviderAvailability, RouteInput } from '../../services/router/types'

const ALL: ProviderAvailability = { claude: true, gemini: true, mistral: true, openai: true, openaiVision: true }
const NONE: ProviderAvailability = { claude: true, gemini: false, mistral: false, openai: false, openaiVision: false }
const PAID: PlanContext = { plan: 'subscription', isPro: false, creditsCoverPremium: false }
const FREE: PlanContext = { plan: 'free', isPro: false, creditsCoverPremium: false }

function input(overrides: Partial<RouteInput> = {}): RouteInput {
  return {
    originalText: 'Explique-moi la loi de Moore',
    hasFiles: false,
    hasImages: false,
    hasPdf: false,
    hasOtherFiles: false,
    hasSupportedVisionImages: false,
    euOnly: false,
    hasPrivateHistory: false,
    selectedModel: 'auto',
    availability: ALL,
    plan: PAID,
    reflectionLevel: 'auto',
    visionOpenAIEnabled: false,
    visionAutoRoutingEnabled: false,
    ...overrides,
  }
}

describe('resolveRoute — invariants euOnly / fichiers (ex-useConversation, 0 test avant)', () => {
  it('euOnly sans accès Mistral est bloqué, sans fallback hors Europe', () => {
    const routeInput = input({ euOnly: true, availability: NONE, plan: FREE })
    expect(canExecuteRoute(routeInput)).toBe(false)
    // La décision de résidence reste Mistral ; c'est l'exécution qui est
    // refusée avant l'appel réseau.
    expect(resolveRoute(routeInput).provider).toBe('mistral')
  })

  it('hors mode EU, le même compte peut utiliser son fallback Haiku', () => {
    expect(canExecuteRoute(input({ availability: NONE, plan: FREE }))).toBe(true)
  })

  it('euOnly → Mistral quel que soit le texte, même privé (RÈGLE 5.3)', () => {
    const d = resolveRoute(input({ euOnly: true, originalText: 'Rapport sur mes mails' }))
    expect(d.provider).toBe('mistral')
    expect(d.reason.code).toBe('eu_only')
    expect(d.webSearch).toBe(false)
  })

  it('euOnly prime sur le choix manuel (le sélecteur est verrouillé en UI)', () => {
    const d = resolveRoute(input({ euOnly: true, selectedModel: 'gemini' }))
    expect(d.provider).toBe('mistral')
    expect(d.overrides).toEqual([
      { requested: 'gemini', applied: 'mistral', reason: { code: 'eu_only' } },
    ])
  })

  it('fichier PDF → Claude, même si Mistral est choisi manuellement (BUG 12)', () => {
    const d = resolveRoute(input({ hasFiles: true, hasPdf: true, selectedModel: 'mistral' }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('files_to_claude')
    expect(d.overrides).toEqual([
      { requested: 'mistral', applied: 'claude', reason: { code: 'files_to_claude' } },
    ])
  })

  it('image (pas de PDF) + Mistral manuel → Mistral (vision native), sans override', () => {
    const d = resolveRoute(input({
      hasFiles: true,
      hasImages: true,
      hasPdf: false,
      hasSupportedVisionImages: true,
      selectedModel: 'mistral',
    }))
    expect(d.provider).toBe('mistral')
    expect(d.reason.code).toBe('files_mistral_native')
    expect(d.overrides).toEqual([])
  })

  it('fichier + Gemini choisi → Claude AVEC override tracé (fini la bascule silencieuse)', () => {
    const d = resolveRoute(input({ hasFiles: true, selectedModel: 'gemini' }))
    expect(d.provider).toBe('claude')
    expect(d.overrides).toEqual([
      { requested: 'gemini', applied: 'claude', reason: { code: 'files_to_claude' } },
    ])
  })

  it('fichier en mode auto → Claude sans override (aucun choix contredit)', () => {
    const d = resolveRoute(input({ hasFiles: true }))
    expect(d.provider).toBe('claude')
    expect(d.overrides).toEqual([])
  })

  it('fichier attaché → JAMAIS hybrid, même sur un trigger rapport (BUG 12)', () => {
    const d = resolveRoute(input({ hasFiles: true, originalText: 'Fais-moi un rapport sur le marché' }))
    expect(d.provider).toBe('claude')
    expect(d.needsHybrid).toBe(false)
  })
})

describe('resolveRoute — matrice Terra vision PR-C', () => {
  const vision = {
    hasFiles: true,
    hasImages: true,
    hasPdf: false,
    hasOtherFiles: false,
    hasSupportedVisionImages: true,
    visionOpenAIEnabled: true,
  }

  it('OpenAI manuel + images canoniques → Terra même si le flag Auto reste OFF', () => {
    const d = resolveRoute(input({ ...vision, selectedModel: 'openai' }))
    expect(d.provider).toBe('openai')
    expect(d.reason.code).toBe('image_vision_openai')
    expect(d.usesOpenAIVision).toBe(true)
    expect(d.overrides).toEqual([])
  })

  it('Auto + flags vision/Auto + disponibilité → Terra', () => {
    const d = resolveRoute(input({ ...vision, visionAutoRoutingEnabled: true }))
    expect(d.provider).toBe('openai')
    expect(d.reason.code).toBe('image_vision_openai')
    expect(d.usesOpenAIVision).toBe(true)
  })

  it('Auto + flag Auto OFF → Claude sans prétendre que Terra est indisponible', () => {
    const d = resolveRoute(input({ ...vision, visionAutoRoutingEnabled: false }))
    expect(d.provider).toBe('claude')
    expect(d.reason).toEqual({ code: 'files_to_claude' })
    expect(d.usesOpenAIVision).toBe(false)
  })

  it('fondation OFF + flag Auto incohérent ON → jamais Terra', () => {
    const d = resolveRoute(input({
      ...vision,
      visionOpenAIEnabled: false,
      visionAutoRoutingEnabled: true,
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason).toEqual({ code: 'files_to_claude' })
    expect(d.usesOpenAIVision).toBe(false)
  })

  it('OpenAI manuel + fondation OFF → Claude/files_to_claude avec override visible', () => {
    const d = resolveRoute(input({
      ...vision,
      selectedModel: 'openai',
      visionOpenAIEnabled: false,
    }))
    expect(d.provider).toBe('claude')
    expect(d.overrides).toEqual([{
      requested: 'openai',
      applied: 'claude',
      reason: { code: 'files_to_claude' },
    }])
  })

  it('Auto + Terra indisponible pour le plan → Claude', () => {
    const d = resolveRoute(input({
      ...vision,
      visionAutoRoutingEnabled: true,
      availability: { ...ALL, openaiVision: false },
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('fallback_no_provider')
  })

  it('OpenAI manuel indisponible → Claude avec override visible', () => {
    const d = resolveRoute(input({
      ...vision,
      selectedModel: 'openai',
      availability: { ...ALL, openaiVision: false },
    }))
    expect(d.provider).toBe('claude')
    expect(d.overrides).toEqual([{
      requested: 'openai',
      applied: 'claude',
      reason: { code: 'fallback_no_provider', params: { preferred: 'openai' } },
    }])
  })

  it('image non canonique → Claude/files_to_claude, jamais Terra', () => {
    const d = resolveRoute(input({
      ...vision,
      hasSupportedVisionImages: false,
      selectedModel: 'openai',
      visionAutoRoutingEnabled: true,
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('files_to_claude')
    expect(d.usesOpenAIVision).toBe(false)
  })

  it('Claude manuel + photos → Claude/manual_selection', () => {
    const d = resolveRoute(input({ ...vision, selectedModel: 'claude' }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('manual_selection')
  })

  it('Gemini manuel + photos → Claude avec override fichiers', () => {
    const d = resolveRoute(input({ ...vision, selectedModel: 'gemini' }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('files_to_claude')
    expect(d.overrides[0]).toMatchObject({ requested: 'gemini', applied: 'claude' })
  })

  it.each([
    ['PDF seul', { hasImages: false, hasPdf: true }],
    ['JPEG + PDF', { hasImages: true, hasPdf: true }],
  ])('%s + flags Terra ON → Claude/files_to_claude', (_label, attachment) => {
    const d = resolveRoute(input({
      ...vision,
      ...attachment,
      hasSupportedVisionImages: false,
      visionAutoRoutingEnabled: true,
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('files_to_claude')
    expect(d.usesOpenAIVision).toBe(false)
  })

  it('historique Google privé + photo + Auto → Claude/private_data', () => {
    const d = resolveRoute(input({
      ...vision,
      hasPrivateHistory: true,
      visionAutoRoutingEnabled: true,
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('private_data')
    expect(d.usesOpenAIVision).toBe(false)
  })

  it('historique Google privé + photo + Mistral manuel → Claude/private_data', () => {
    const d = resolveRoute(input({ ...vision, hasPrivateHistory: true, selectedModel: 'mistral' }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('private_data')
    expect(d.overrides[0]).toMatchObject({ requested: 'mistral', applied: 'claude' })
  })

  it('« mes mails » + photo + OpenAI manuel → Claude/private_data + override', () => {
    const d = resolveRoute(input({
      ...vision,
      originalText: 'Analyse cette photo avec mes mails',
      selectedModel: 'openai',
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('private_data')
    expect(d.overrides[0]).toMatchObject({ requested: 'openai', applied: 'claude' })
  })

  it('euOnly reste prioritaire sur Terra et conserve Mistral', () => {
    const d = resolveRoute(input({ ...vision, euOnly: true, visionAutoRoutingEnabled: true }))
    expect(d.provider).toBe('mistral')
    expect(d.reason.code).toBe('eu_only')
    expect(d.usesOpenAIVision).toBe(false)
  })

  it('euOnly + OpenAI manuel + JPEG → Mistral avec override explicite', () => {
    const d = resolveRoute(input({
      ...vision,
      euOnly: true,
      selectedModel: 'openai',
      visionAutoRoutingEnabled: true,
    }))
    expect(d.provider).toBe('mistral')
    expect(d.reason.code).toBe('eu_only')
    expect(d.overrides).toEqual([{
      requested: 'openai',
      applied: 'mistral',
      reason: { code: 'eu_only' },
    }])
  })
})

describe('resolveRoute — choix manuel et garde données privées', () => {
  it('choix manuel respecté avec raison manual_selection', () => {
    const d = resolveRoute(input({ selectedModel: 'gemini' }))
    expect(d.provider).toBe('gemini')
    expect(d.reason.code).toBe('manual_selection')
    expect(d.overrides).toEqual([])
  })

  it('privé + Gemini manuel → Claude avec override private_data', () => {
    const d = resolveRoute(input({ selectedModel: 'gemini', originalText: 'Montre mes emails' }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('private_data')
    expect(d.overrides).toEqual([
      { requested: 'gemini', applied: 'claude', reason: { code: 'private_data' } },
    ])
  })

  it('privé + Mistral manuel → Claude : private_data précède le carve-out photo', () => {
    const d = resolveRoute(input({ selectedModel: 'mistral', originalText: 'Montre mes emails' }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('private_data')
    expect(d.overrides).toEqual([
      { requested: 'mistral', applied: 'claude', reason: { code: 'private_data' } },
    ])
  })
})

describe('resolveRoute — raisons de la cascade auto', () => {
  const cases: Array<[string, string, string]> = [
    ['Montre mes emails', 'claude', 'private_data'],
    ['https://youtu.be/VMUDRIYRoQs', 'gemini', 'youtube_native'],
    ['Résume https://example.com/article', 'claude', 'url_web_fetch'],
    ['Fais-moi un rapport sur le marché', 'hybrid', 'hybrid_research'],
    ['merci beaucoup', 'mistral', 'trivial_chat'],
    ['Explique-moi la loi de Moore', 'gemini', 'default_capable'],
  ]
  it.each(cases)('« %s » → %s (%s)', (text, provider, code) => {
    const d = resolveRoute(input({ originalText: text }))
    expect(d.provider).toBe(provider)
    expect(d.reason.code).toBe(code)
  })

  it('sans aucun provider dispo → Claude en fallback_no_provider', () => {
    const d = resolveRoute(input({ availability: NONE }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('fallback_no_provider')
  })

  it('historique Google privé + « résume ça » → jamais Gemini/OpenAI', () => {
    const auto = resolveRoute(input({ originalText: 'résume ça', hasPrivateHistory: true }))
    expect(auto.provider).toBe('claude')
    expect(auto.reason.code).toBe('private_data')
    expect(auto.isPrivateData).toBe(true)
    expect(auto.webSearch).toBe(false)

    const manualOpenAI = resolveRoute(input({
      originalText: 'résume ça',
      hasPrivateHistory: true,
      selectedModel: 'openai',
    }))
    expect(manualOpenAI.provider).toBe('claude')
    expect(manualOpenAI.overrides[0]?.reason.code).toBe('private_data')
    expect(manualOpenAI.webSearch).toBe(false)
  })

  it('euOnly + historique privé retire aussi la recherche publique de Mistral', () => {
    const d = resolveRoute(input({
      euOnly: true,
      hasPrivateHistory: true,
      originalText: 'quel temps demain à Voiron ?',
    }))
    expect(d.provider).toBe('mistral')
    expect(d.isPrivateData).toBe(true)
    expect(d.webSearch).toBe(false)
  })

  it('sélection manuelle périmée sur un compte free → Claude Haiku avant envoi', () => {
    const d = resolveRoute(input({
      selectedModel: 'gemini',
      availability: NONE,
      plan: FREE,
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('fallback_no_provider')
    expect(d.subModelReason?.code).toBe('plan_locked_haiku')
    expect(d.overrides).toEqual([
      {
        requested: 'gemini',
        applied: 'claude',
        reason: { code: 'fallback_no_provider', params: { preferred: 'gemini' } },
      },
    ])
  })

  it('URL + mention ChatGPT en Auto → Claude sans toast d’override manuel', () => {
    const d = resolveRoute(input({ originalText: 'Résume https://example.com avec ChatGPT' }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('url_web_fetch')
    expect(d.overrides).toEqual([])
  })
})

describe('resolveRoute — sous-décision Claude sur le texte ORIGINAL', () => {
  it('hybrid : le sous-modèle/thinking sont calculés (Claude rédige)', () => {
    const d = resolveRoute(input({ originalText: 'Fais-moi un rapport sur le marché', plan: PAID }))
    expect(d.provider).toBe('hybrid')
    expect(d.subModel).toBeDefined()
    expect(d.thinking.enabled).toBe(true)
  })

  it('plan free sans crédits → Haiku avec raison plan_locked_haiku', () => {
    const d = resolveRoute(input({ availability: NONE, plan: FREE }))
    expect(d.provider).toBe('claude')
    expect(d.subModel).toBe('claude-haiku-4-5-20251001')
    expect(d.subModelReason?.code).toBe('plan_locked_haiku')
  })

  it('rapport stratégique Pro → Opus (submodel_opus_report)', () => {
    const d = resolveRoute(input({
      availability: NONE,
      originalText: 'Fais-moi un rapport stratégique complet',
      plan: { plan: 'subscription', isPro: true, creditsCoverPremium: false },
    }))
    expect(d.subModel).toBe('claude-opus-4-8')
    expect(d.subModelReason?.code).toBe('submodel_opus_report')
  })

  it('webSearch reflète shouldUseWebSearch sur le texte original', () => {
    expect(resolveRoute(input({ originalText: 'quel temps demain à Voiron' })).webSearch).toBe(true)
    expect(resolveRoute(input({ originalText: 'merci !' })).webSearch).toBe(false)
    expect(resolveRoute(input({ originalText: 'fais un rapport sur mes mails' })).webSearch).toBe(false)
  })

  it('provider non-Claude → thinking coupé, pas de subModel', () => {
    const d = resolveRoute(input({ originalText: 'Explique-moi la loi de Moore' }))
    expect(d.provider).toBe('gemini')
    expect(d.thinking).toEqual({ enabled: false, budget: 0, effort: null })
    expect(d.subModel).toBeUndefined()
  })
})

describe('resolveRoute — sentiers/GPX → Claude (trail_tools, juillet 2026)', () => {
  // Le cas terrain fondateur : la demande de Florent sur Viriville partait
  // chez Gemini (default_capable) qui n'a aucun outil custom → échec garanti.
  it('la demande fondatrice (boucles équestres Viriville + GPX) → Claude', () => {
    const d = resolveRoute(input({
      originalText:
        "Peux-tu me préparer des boucles de randonnée au départ de la maison à Viriville, " +
        'en privilégiant les chemins de terre ? Je voudrais des traces GPX.',
    }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('trail_tools')
  })

  it.each([
    'cherche des sentiers autour de Viriville',
    'une balade à cheval sympa près de chez moi',
    'trouve-moi une rando de 10 km',
    'tu peux me générer un fichier GPX du circuit ?',
    'des circuits VTT dans le coin ?',
    'où passe le GR 65 ?',
    'any horse riding trails near Viriville?',
    // Cas terrain 19 juil. 2026 (capture Florent, APK) : partait sur Gemini.
    'Cherche des chemins autour de viriville',
    'des chemins près de la maison ?',
    'une balade autour de Viriville',
    'où se balader vers Viriville ?',
    'y a des pistes cavalières dans le coin ?',
  ])('phrasing indirect « %s » → Claude/trail_tools', (text) => {
    const d = resolveRoute(input({ originalText: text }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('trail_tools')
  })

  it('le trigger ne détourne PAS une question générale vers Claude', () => {
    for (const text of [
      'Explique-moi la loi de Moore',
      "l'histoire du chemin de fer en France",
      'quel est le plus court chemin en théorie des graphes ?',
    ]) {
      const d = resolveRoute(input({ originalText: text }))
      expect(d.provider, text).toBe('gemini')
      expect(d.reason.code, text).toBe('default_capable')
    }
  })

  it('suivi court dans une conversation sentiers → Claude même sans trigger texte', () => {
    // Cas terrain 19 juil. (2e session) : « Viriville » seul en réponse à une
    // discussion sentiers partait sur Gemini sans outils → pas de bouton carte.
    const d = resolveRoute(input({ originalText: 'Viriville', hasTrailHistory: true }))
    expect(d.provider).toBe('claude')
    expect(d.reason.code).toBe('trail_tools')
  })

  it('le contexte sentiers ne détourne PAS les messages triviaux du chemin rapide', () => {
    const d = resolveRoute(input({ originalText: 'merci !', hasTrailHistory: true }))
    expect(d.provider).toBe('mistral')
    expect(d.reason.code).toBe('trivial_chat')
  })

  it('sans contexte sentiers, « Viriville » seul reste sur le défaut', () => {
    const d = resolveRoute(input({ originalText: 'Viriville' }))
    expect(d.provider).toBe('gemini')
    expect(d.reason.code).toBe('default_capable')
  })

  it("les gardes absolues restent prioritaires : euOnly prime sur trail_tools", () => {
    const d = resolveRoute(input({ euOnly: true, originalText: 'prépare une rando GPX' }))
    expect(d.provider).toBe('mistral')
    expect(d.reason.code).toBe('eu_only')
  })

  it('un choix manuel Gemini reste respecté (pas d\'override sur simple intent)', () => {
    const d = resolveRoute(input({ selectedModel: 'gemini', originalText: 'cherche une rando GPX' }))
    expect(d.provider).toBe('gemini')
    expect(d.reason.code).toBe('manual_selection')
    expect(d.overrides).toEqual([])
  })
})
