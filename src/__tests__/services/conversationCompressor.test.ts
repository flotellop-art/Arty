import { describe, it, expect } from 'vitest'

// apiBase importe @capacitor/core ; on le neutralise pour un import propre.
import { vi } from 'vitest'
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))

import { estimateMessagesTokens, COMPRESSION_THRESHOLD } from '../../services/conversationCompressor'

describe('estimateMessagesTokens', () => {
  it('estimates a plain string message ~ length / 3.8 (+ overhead)', () => {
    const content = 'a'.repeat(380) // ~100 tokens
    const tokens = estimateMessagesTokens([{ role: 'user', content }])
    // 380 / 3.8 = 100, plus 10 overhead.
    expect(tokens).toBe(110)
  })

  it('REGRESSION: counts the real text of a tool_result block (not ~4 tokens)', () => {
    // Avant le fix : un tool_result non-string était écrasé en
    // '[contenu multimédia]' (~5 tokens) → context rot. Un corps d'email de
    // 8000 chars doit maintenant peser ~2100 tokens.
    const emailBody = 'mot '.repeat(2000) // 8000 chars
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x', content: emailBody },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    expect(tokens).toBeGreaterThan(1500)
  })

  it('counts text inside tool_result sub-blocks (array form)', () => {
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'x',
            content: [
              { type: 'text', text: 'z'.repeat(3800) }, // ~1000 tokens
            ],
          },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    expect(tokens).toBeGreaterThan(900)
    expect(tokens).toBeLessThan(1100)
  })

  it('ANTI-THRASH: counts a base64 document block at a small nominal, NOT its full size', () => {
    // Un PDF de 5 Mo en base64 = ~5M chars. Le compter en entier
    // (~1,3M tokens) déclencherait une compression Sonnet à chaque tour.
    const hugeBase64 = 'A'.repeat(5_000_000)
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'x',
            content: [
              { type: 'text', text: 'Voici le PDF' },
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: hugeBase64 } },
            ],
          },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    // Doit rester petit (poids nominal ~2000), très loin des centaines de
    // milliers qu'un comptage base64 produirait.
    expect(tokens).toBeLessThan(5000)
  })

  it('counts a top-level document block (user attachment) at nominal weight', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyse ce doc' },
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'A'.repeat(1_000_000) } },
        ],
      },
    ]
    const tokens = estimateMessagesTokens(messages)
    expect(tokens).toBeLessThan(5000)
  })

  it('exposes a sane threshold constant', () => {
    expect(COMPRESSION_THRESHOLD).toBe(80000)
  })
})
