// P1.5 — partage public : la sérialisation est le point sécurité (ce qui sort
// du chiffrement local). On vérifie ce qui est INCLUS et surtout EXCLU.
import { describe, it, expect } from 'vitest'
import { buildSharePayload } from '../../services/shareClient'
import type { Conversation } from '../../types'

function conv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1', title: 'Ma conv', createdAt: 1, updatedAt: 2,
    messages: [
      { id: 'm1', role: 'user', content: 'Bonjour', timestamp: 10 },
      { id: 'm2', role: 'assistant', content: 'Salut !', timestamp: 11, pinned: true, interrupted: true,
        files: [{ id: 'f1', name: 'x.png', type: 'image/png', size: 100, data: 'BIGBASE64==' }] },
    ],
    ...over,
  }
}

describe('buildSharePayload', () => {
  it('inclut role/content/timestamp', () => {
    const p = buildSharePayload(conv())
    expect(p.messages).toEqual([
      { role: 'user', content: 'Bonjour', timestamp: 10 },
      { role: 'assistant', content: 'Salut !', timestamp: 11 },
    ])
  })

  it('EXCLUT files/base64, pinned, interrupted, factCheck', () => {
    const json = JSON.stringify(buildSharePayload(conv()))
    expect(json).not.toContain('BIGBASE64')
    expect(json).not.toContain('pinned')
    expect(json).not.toContain('interrupted')
    expect(json).not.toContain('files')
  })

  it('neutralise les images générées (réf. locale arty-img://)', () => {
    const p = buildSharePayload(conv({
      messages: [{ id: 'm', role: 'assistant', content: 'Voici : ![chat](arty-img://lm-123) et voilà', timestamp: 1 }],
    }))
    expect(p.messages[0]!.content).not.toContain('arty-img://')
    expect(p.messages[0]!.content).toContain('non incluse dans le partage')
  })

  it('exclut le placeholder de stream en cours', () => {
    const p = buildSharePayload(conv({
      messages: [
        { id: 'm1', role: 'user', content: 'Q', timestamp: 1 },
        { id: 'streaming', role: 'assistant', content: 'partiel...', timestamp: 2 },
      ],
    }))
    expect(p.messages).toHaveLength(1)
  })

  it('propage les flags euOnly et hasGoogleData', () => {
    expect(buildSharePayload(conv({ euOnly: true })).euOnly).toBe(true)
    expect(buildSharePayload(conv({ hasGoogleData: true })).hasGoogleData).toBe(true)
    expect(buildSharePayload(conv()).euOnly).toBe(false)
  })
})
