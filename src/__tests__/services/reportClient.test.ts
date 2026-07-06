// Signalement de contenu IA (policy Play Store AI-Generated Content) — la
// sérialisation est le point sensible : extraits TRONQUÉS, jamais le message
// complet ni les fichiers, et le contexte user qui précède pour le triage.
import { describe, it, expect } from 'vitest'
import { buildReportPayload } from '../../services/reportClient'
import type { Conversation, Message } from '../../types'

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1', title: 'Ma conv', createdAt: 1, updatedAt: 2,
    messages: [
      { id: 'u1', role: 'user', content: 'Question initiale', timestamp: 10 },
      { id: 'a1', role: 'assistant', content: 'Réponse 1', timestamp: 11 },
      { id: 'u2', role: 'user', content: 'Question suivante', timestamp: 12,
        files: [{ id: 'f1', name: 'x.png', type: 'image/png', size: 100, data: 'BIGBASE64==' }] },
      { id: 'a2', role: 'assistant', content: 'Réponse signalée', timestamp: 13 },
    ],
    ...over,
  }
}

function msgById(c: Conversation, id: string): Message {
  const m = c.messages.find((x) => x.id === id)
  if (!m) throw new Error('message introuvable')
  return m
}

describe('buildReportPayload', () => {
  it('inclut catégorie, extrait du message et question user précédente', () => {
    const c = conv()
    const p = buildReportPayload(c, msgById(c, 'a2'), 'offensive', '  du contexte  ')
    expect(p.category).toBe('offensive')
    expect(p.messageExcerpt).toBe('Réponse signalée')
    expect(p.precedingExcerpt).toBe('Question suivante')
    expect(p.freeText).toBe('du contexte')
  })

  it('tronque le message signalé à 2000 caractères', () => {
    const long = 'x'.repeat(5000)
    const c = conv({ messages: [{ id: 'a', role: 'assistant', content: long, timestamp: 1 }] })
    const p = buildReportPayload(c, msgById(c, 'a'), 'other', '')
    expect(p.messageExcerpt.length).toBe(2001) // 2000 + '…'
    expect(p.messageExcerpt.endsWith('…')).toBe(true)
  })

  it('plafonne le champ libre à 500 caractères', () => {
    const c = conv()
    const p = buildReportPayload(c, msgById(c, 'a2'), 'other', 'y'.repeat(900))
    expect(p.freeText.length).toBe(501) // 500 + '…'
  })

  it("EXCLUT les fichiers/base64 (seul le texte de l'extrait part)", () => {
    const c = conv()
    const json = JSON.stringify(buildReportPayload(c, msgById(c, 'a2'), 'other', ''))
    expect(json).not.toContain('BIGBASE64')
    expect(json).not.toContain('files')
  })

  it('ignore le placeholder de stream comme message précédent', () => {
    const c = conv({
      messages: [
        { id: 'u1', role: 'user', content: 'Vraie question', timestamp: 1 },
        { id: 'streaming', role: 'user', content: 'partiel…', timestamp: 2 },
        { id: 'a1', role: 'assistant', content: 'Réponse', timestamp: 3 },
      ],
    })
    const p = buildReportPayload(c, msgById(c, 'a1'), 'dangerous', '')
    expect(p.precedingExcerpt).toBe('Vraie question')
  })

  it('propage euOnly et usedModels (au niveau CONVERSATION, nommé honnêtement)', () => {
    const c = conv({ euOnly: true, usedModels: ['mistral', 'claude'] })
    const p = buildReportPayload(c, msgById(c, 'a2'), 'misinformation', '')
    expect(p.euOnly).toBe(true)
    expect(p.usedModelsInConversation).toEqual(['mistral', 'claude'])
  })
})
