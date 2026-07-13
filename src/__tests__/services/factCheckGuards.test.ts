// Gardes de runFactCheckOnLatest (refactor « publication immédiate »,
// juillet 2026). Depuis le retrait du mode publish-after-fact-check,
// runFactCheckOnLatest est le CHEMIN UNIQUE du fact-check — ces invariants
// n'étaient couverts par aucun test :
//   1. euOnly → aucun appel réseau (RGPD RÈGLE 5.3 : le fact-checker tourne
//      sur Claude/US ; le gate du call site doit être doublé dans le service).
//   2. Réponse interrompue (Stop) → skip (contenu partiel, quota gaspillé).
//   3. Écritures IMMUABLES (pattern H1) : le message et l'array messages
//      doivent être REMPLACÉS, jamais mutés — sinon les memo() de
//      MessageList/MessageItem ne re-rendent jamais badge ni correction.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/apiBase', () => ({
  apiUrl: (p: string) => p,
}))

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => 'tok-test'),
}))

vi.mock('../../services/costTracker', () => ({
  recordUsage: vi.fn(),
}))

// Mode explicite 'haiku' : un seul palier, pas d'escalade — le test contrôle
// exactement 1 fetch attendu sur le chemin succès.
vi.mock('../../services/scopedStorage', () => ({
  getItem: vi.fn((key: string) => (key === 'fact-check-mode' ? 'haiku' : null)),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}))

vi.mock('../../services/storage', () => {
  const convs = new Map<string, unknown>()
  return {
    getConversation: vi.fn((id: string) => convs.get(id)),
    saveConversation: vi.fn((c: { id: string }) => convs.set(c.id, c)),
    __convs: convs,
  }
})

import { runFactCheckOnLatest } from '../../services/factChecker'
import * as storage from '../../services/storage'
import type { Conversation, Message } from '../../types'

const convStore = (storage as unknown as { __convs: Map<string, Conversation> }).__convs

function makeMessages(): Message[] {
  return [
    { id: 'u1', role: 'user', content: 'Quelle hauteur fait la tour Eiffel ?', timestamp: 1 },
    {
      id: 'a1',
      role: 'assistant',
      content: 'La tour Eiffel mesure 350 mètres, un fait souvent cité dans les guides touristiques parisiens.',
      timestamp: 2,
    },
  ]
}

function makeConv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'test',
    messages: makeMessages(),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  convStore.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('runFactCheckOnLatest — gardes', () => {
  it('conversation euOnly → AUCUN appel réseau, message intact (RGPD RÈGLE 5.3)', async () => {
    const conv = makeConv({ euOnly: true })
    convStore.set(conv.id, conv)

    await runFactCheckOnLatest('conv-1', () => {})

    expect(fetchMock).not.toHaveBeenCalled()
    const after = convStore.get('conv-1')!
    expect(after.messages[1]!.factCheck).toBeUndefined()
  })

  it('réponse interrompue (Stop) → skip, aucun appel réseau', async () => {
    const conv = makeConv()
    conv.messages[1] = { ...conv.messages[1]!, interrupted: true }
    convStore.set(conv.id, conv)

    await runFactCheckOnLatest('conv-1', () => {})

    expect(fetchMock).not.toHaveBeenCalled()
    expect(convStore.get('conv-1')!.messages[1]!.factCheck).toBeUndefined()
  })

  it('succès : correction rétro-appliquée par REMPLACEMENT immuable (pattern H1)', async () => {
    const conv = makeConv()
    convStore.set(conv.id, conv)
    const originalMessages = conv.messages
    const originalAssistant = conv.messages[1]!

    const llmJson = JSON.stringify({
      overall_confidence: 'low',
      claims: [
        {
          claim: 'La tour Eiffel mesure 350 mètres',
          verdict: 'wrong',
          explanation: 'Elle mesure 330 mètres depuis 2022.',
          originalText: 'mesure 350 mètres',
          correction: 'mesure 330 mètres',
        },
      ],
    })
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: llmJson }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200 }
      )
    )

    const refresh = vi.fn()
    await runFactCheckOnLatest('conv-1', refresh)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const after = convStore.get('conv-1')!
    const target = after.messages.find((m) => m.id === 'a1')!

    // Résultat attaché + correction appliquée sur le message stocké.
    expect(target.content).toContain('mesure 330 mètres')
    expect(target.factCheck?.status).toBe('success-with-claims')
    expect(target.factCheck?.appliedCorrections).toBe(1)

    // IMMUTABILITÉ (load-bearing pour les memo() de MessageList/MessageItem) :
    // l'objet message et l'array d'origine ne doivent PAS avoir été mutés.
    expect(originalAssistant.content).toContain('mesure 350 mètres')
    expect(after.messages).not.toBe(originalMessages)
    expect(target).not.toBe(originalAssistant)
    expect(refresh).toHaveBeenCalled()
  })

  it('échec réseau → badge failed posé en immuable, contenu préservé', async () => {
    const conv = makeConv()
    convStore.set(conv.id, conv)
    const originalAssistant = conv.messages[1]!
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await runFactCheckOnLatest('conv-1', () => {})

    const after = convStore.get('conv-1')!
    const target = after.messages.find((m) => m.id === 'a1')!
    expect(target.factCheck?.status).toBe('failed')
    expect(target.content).toBe(originalAssistant.content)
    expect(originalAssistant.factCheck).toBeUndefined()
  })
})
