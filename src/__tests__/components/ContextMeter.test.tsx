import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Message } from '../../types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
// conversationCompressor importe apiBase (@capacitor/core) au transitif.
vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))

import { ContextMeter, contextBand } from '../../components/chat/ContextMeter'

function msg(content: string): Message {
  return { id: Math.random().toString(36), role: 'user', content, timestamp: 0 }
}

// estimateMessagesTokens ≈ ceil(len/3.8)+10 ; COMPRESSION_THRESHOLD = 80000.
// 200k chars ≈ 52.6k tokens ≈ 66% → warn. 300k chars ≈ 79k tokens ≈ 99% → high.
const warnMessages = [msg('a'.repeat(200_000))]
const highMessages = [msg('a'.repeat(300_000))]

describe('contextBand', () => {
  it('hidden sous 60 %', () => {
    expect(contextBand(0)).toBe('hidden')
    expect(contextBand(0.59)).toBe('hidden')
  })
  it('warn entre 60 et 80 %', () => {
    expect(contextBand(0.6)).toBe('warn')
    expect(contextBand(0.79)).toBe('warn')
  })
  it('high à partir de 80 %', () => {
    expect(contextBand(0.8)).toBe('high')
    expect(contextBand(1)).toBe('high')
  })
})

describe('ContextMeter', () => {
  it('ne rend rien sur une conversation courte', () => {
    const html = renderToStaticMarkup(<ContextMeter messages={[msg('salut')]} />)
    expect(html).toBe('')
  })

  it('bande warn : barre visible, AUCUN CTA nouvelle conversation', () => {
    const html = renderToStaticMarkup(
      <ContextMeter messages={warnMessages} onNewConversation={() => {}} />,
    )
    expect(html).toContain('progressbar')
    expect(html).toContain('chat.contextMeter.label')
    expect(html).not.toContain('chat.contextMeter.newConv')
    expect(html).not.toContain('chat.contextMeter.nudge')
  })

  it('bande high : nudge + CTA nouvelle conversation', () => {
    const html = renderToStaticMarkup(
      <ContextMeter messages={highMessages} onNewConversation={() => {}} />,
    )
    expect(html).toContain('chat.contextMeter.nudge')
    expect(html).toContain('chat.contextMeter.newConv')
    expect(html).toContain('progressbar')
  })

  it('bande high sans handler : pas de bouton CTA mais le nudge reste', () => {
    const html = renderToStaticMarkup(<ContextMeter messages={highMessages} />)
    expect(html).toContain('chat.contextMeter.nudge')
    expect(html).not.toContain('chat.contextMeter.newConv')
  })
})
