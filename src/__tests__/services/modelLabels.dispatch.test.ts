// Tests PR C-A (CDC visibilité modèle, 5 juillet 2026) — exactitude du
// signal 'arty-model-used'. Trois volets :
//  1. shouldAcceptModelEvent — filtre commun des surfaces de conversation
//     (F-4 : le brief proactif Haiku 🇺🇸 écrasait le badge d'une conversation
//     Mistral 🇪🇺 ; les streams concurrents d'une autre conversation aussi).
//  2. dispatchModelUsed — le cache module (init des surfaces au mount)
//     ignore les appels background.
//  3. Parité SOURCE des 4 clients IA — chaque client DOIT dispatcher l'event.
//     openaiClient ne l'a jamais fait pendant des mois sans qu'aucun test ne
//     le détecte (F-3) : ce test ferme la classe de bug. Même pattern
//     source-scan que computerUseSafety.test.ts.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dispatchModelUsed,
  getLastModelUsed,
  shouldAcceptModelEvent,
  type ModelUsedEvent,
} from '../../services/modelLabels'

const ev = (over: Partial<ModelUsedEvent> = {}): ModelUsedEvent => ({
  model: 'claude-sonnet-5',
  provider: 'claude',
  ...over,
})

describe('shouldAcceptModelEvent — filtre des surfaces de conversation', () => {
  it('accepte un event de conversation sans conversationId (appelant legacy)', () => {
    expect(shouldAcceptModelEvent(ev())).toBe(true)
    expect(shouldAcceptModelEvent(ev(), 'conv-1')).toBe(true)
  })

  it('accepte un event de la conversation active', () => {
    expect(shouldAcceptModelEvent(ev({ conversationId: 'conv-1' }), 'conv-1')).toBe(true)
  })

  it('rejette un event d\'une AUTRE conversation (streams concurrents)', () => {
    expect(shouldAcceptModelEvent(ev({ conversationId: 'conv-2' }), 'conv-1')).toBe(false)
  })

  it('rejette TOUT appel d\'arrière-plan (brief, résumé, comparateur)', () => {
    expect(shouldAcceptModelEvent(ev({ background: true }))).toBe(false)
    expect(shouldAcceptModelEvent(ev({ background: true, conversationId: 'conv-1' }), 'conv-1')).toBe(false)
  })

  it('accepte un event quand la surface ne connaît pas sa conversation', () => {
    // StreamingIndicator n'a pas de prop conversationId — il ne filtre que
    // le background. Un event scopé reste accepté sans id actif fourni.
    expect(shouldAcceptModelEvent(ev({ conversationId: 'conv-1' }))).toBe(true)
  })

  it('rejette les events malformés', () => {
    expect(shouldAcceptModelEvent(undefined)).toBe(false)
    expect(shouldAcceptModelEvent(null)).toBe(false)
    expect(shouldAcceptModelEvent({ model: '', provider: 'claude' })).toBe(false)
  })
})

describe('dispatchModelUsed — cache module', () => {
  it('un appel background ne remplace pas le dernier modèle de conversation', () => {
    dispatchModelUsed(ev({ model: 'mistral-medium-latest', provider: 'mistral', conversationId: 'conv-1' }))
    dispatchModelUsed(ev({ model: 'claude-haiku-4-5-20251001', background: true }))
    expect(getLastModelUsed()?.model).toBe('mistral-medium-latest')
  })

  it('un event confirmed de conversation met à jour le cache (vérité serveur)', () => {
    dispatchModelUsed(ev({ model: 'claude-sonnet-5', conversationId: 'conv-1' }))
    dispatchModelUsed(ev({ model: 'claude-haiku-4-5-20251001', confirmed: true, conversationId: 'conv-1' }))
    expect(getLastModelUsed()?.model).toBe('claude-haiku-4-5-20251001')
  })

  it('dispatche bien l\'event window, background inclus', () => {
    const received: ModelUsedEvent[] = []
    const listener = (e: Event) => received.push((e as CustomEvent<ModelUsedEvent>).detail)
    window.addEventListener('arty-model-used', listener)
    try {
      dispatchModelUsed(ev({ background: true }))
      dispatchModelUsed(ev({ conversationId: 'conv-1' }))
    } finally {
      window.removeEventListener('arty-model-used', listener)
    }
    // Les deux partent (une surface dédiée — modale du résumé — pourrait
    // vouloir écouter son propre appel background) ; c'est le FILTRE côté
    // surface de conversation qui fait le tri, pas le dispatch.
    expect(received).toHaveLength(2)
    expect(received.filter((d) => shouldAcceptModelEvent(d))).toHaveLength(1)
  })
})

describe('parité source — les 4 clients IA dispatchent arty-model-used', () => {
  const clientSource = (name: string) =>
    readFileSync(resolve(process.cwd(), `src/services/${name}.ts`), 'utf8')

  // Tout NOUVEAU client IA de conversation (RÈGLE 3, étape 2) doit être
  // ajouté ici ET appeler dispatchModelUsed — sinon son modèle est invisible
  // (badge muet ou figé sur le provider précédent, drapeau région faux).
  const CLIENTS = ['anthropicClient', 'mistralClient', 'geminiClient', 'openaiClient']

  it.each(CLIENTS)('%s appelle dispatchModelUsed', (name) => {
    expect(clientSource(name)).toMatch(/dispatchModelUsed\(/)
  })

  it('geminiClient ne dispatche qu\'UNE fois (F-6 — le second dispatch sans `reflecting` éteignait l\'indicateur de réflexion avant le premier token)', () => {
    const calls = clientSource('geminiClient').match(/dispatchModelUsed\(/g) ?? []
    expect(calls).toHaveLength(1)
  })

  it.each(['anthropicClient', 'mistralClient', 'openaiClient'])(
    '%s referme la boucle demandé→servi (dispatch correctif confirmed)',
    (name) => {
      // Gemini est exclu : son API ne renvoie pas le modèle servi dans les
      // chunks — seul client dont l'event reste une déclaration d'intention.
      expect(clientSource(name)).toMatch(/confirmed: true/)
    }
  )
})
