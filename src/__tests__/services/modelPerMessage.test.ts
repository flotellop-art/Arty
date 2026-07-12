// Tests PR C-B/C-C (CDC visibilité modèle, 5 juillet 2026) — attribution du
// modèle PAR MESSAGE : libellé capacité (footer), exclusion du partage public
// (décision D3) et inclusion dans les exports privés.
import { describe, expect, it } from 'vitest'
import { getModelCapacityKey } from '../../services/modelLabels'
import { buildSharePayload } from '../../services/shareClient'
import { buildConversationMarkdown, buildConversationHtml } from '../../services/conversationExport'
import type { Conversation } from '../../types'

describe('getModelCapacityKey — libellé capacité du footer', () => {
  it.each([
    ['mistral-medium-latest', 'chat.modelFooter.capacity.mistral'],
    ['mistral-medium-2505', 'chat.modelFooter.capacity.mistral'],
    ['gemini-2.5-flash', 'chat.modelFooter.capacity.gemini'],
    ['gemini-3.5-flash', 'chat.modelFooter.capacity.gemini'],
    ['claude-haiku-4-5-20251001', 'chat.modelFooter.capacity.haiku'],
    ['claude-sonnet-5', 'chat.modelFooter.capacity.claude'],
    ['claude-sonnet-5-20250929', 'chat.modelFooter.capacity.claude'],
    ['claude-opus-4-8', 'chat.modelFooter.capacity.claude'],
    ['gpt-5.5', 'chat.modelFooter.capacity.openai'],
    ['gpt-5', 'chat.modelFooter.capacity.openai'],
    ['modele-inconnu', 'chat.modelFooter.capacity.fallback'],
  ])('%s → %s', (model, key) => {
    expect(getModelCapacityKey(model)).toBe(key)
  })
})

const conv = (): Conversation => ({
  id: 'c1',
  title: 'Test',
  createdAt: 1750000000000,
  updatedAt: 1750000000000,
  usedModels: ['claude'],
  messages: [
    { id: 'u1', role: 'user', content: 'Question ?', timestamp: 1750000000000 },
    {
      id: 'a1',
      role: 'assistant',
      content: 'Réponse.',
      timestamp: 1750000001000,
      model: 'claude-sonnet-5-20250929',
      reasonCode: 'private_data',
      subModelReasonCode: 'submodel_sonnet_default',
    },
    // Message antérieur au déploiement : pas de champ model (rétro-compat).
    { id: 'a2', role: 'assistant', content: 'Ancienne réponse.', timestamp: 1750000002000 },
  ],
})

describe('partage public — Message.model EXCLU (décision D3)', () => {
  it('buildSharePayload ne sérialise jamais le modèle par message', () => {
    const payload = buildSharePayload(conv())
    expect(payload.messages).toHaveLength(3)
    for (const m of payload.messages) {
      // Garantie par le mapping explicite role/content/timestamp — ce test
      // casse si quelqu'un le remplace par un spread `...m`.
      expect(Object.keys(m).sort()).toEqual(['content', 'role', 'timestamp'])
      expect((m as Record<string, unknown>).model).toBeUndefined()
      expect((m as Record<string, unknown>).reasonCode).toBeUndefined()
      expect((m as Record<string, unknown>).subModelReasonCode).toBeUndefined()
    }
  })
})

describe('exports privés — modèle par message INCLUS (décision D3)', () => {
  it('markdown : label produit sur les réponses assistant qui ont un modèle', () => {
    const md = buildConversationMarkdown(conv())
    expect(md).toContain('Claude Sonnet 5')
    // Le message sans champ model n'invente rien : une seule occurrence.
    expect(md.match(/Claude Sonnet 5/g)).toHaveLength(1)
  })

  it('html/pdf : label produit présent et échappé', () => {
    const html = buildConversationHtml(conv())
    expect(html).toContain('Claude Sonnet 5')
    expect(html.match(/Claude Sonnet 5/g)).toHaveLength(1)
  })
})
