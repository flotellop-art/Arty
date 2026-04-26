import { describe, it, expect } from 'vitest'
import {
  buildConversationMarkdown,
  buildConversationHtml,
} from '../../services/conversationExport'
import type { Conversation } from '../../types'

const fakeConv: Conversation = {
  id: 'test-id',
  title: 'Test conv',
  createdAt: new Date('2026-04-26T10:00:00Z').getTime(),
  updatedAt: new Date('2026-04-26T11:00:00Z').getTime(),
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: 'Bonjour Arty',
      timestamp: new Date('2026-04-26T10:00:00Z').getTime(),
    },
    {
      id: 'm2',
      role: 'assistant',
      content: "**Salut !** Comment je peux t'aider ?",
      timestamp: new Date('2026-04-26T10:00:30Z').getTime(),
    },
  ],
  usedModels: ['claude'],
}

describe('buildConversationMarkdown', () => {
  it('produces a header with title and metadata', () => {
    const md = buildConversationMarkdown(fakeConv)
    expect(md).toContain('# Test conv')
    expect(md).toContain('Modèles utilisés : claude')
  })

  it('includes both messages with role labels', () => {
    const md = buildConversationMarkdown(fakeConv)
    expect(md).toContain('👤 **Utilisateur**')
    expect(md).toContain('🤖 **Arty**')
    expect(md).toContain('Bonjour Arty')
    expect(md).toContain('Salut !')
  })

  it('preserves markdown formatting in message content', () => {
    const md = buildConversationMarkdown(fakeConv)
    expect(md).toContain("**Salut !** Comment je peux t'aider ?")
  })

  it('handles EU flag', () => {
    const euConv = { ...fakeConv, euOnly: true }
    expect(buildConversationMarkdown(euConv)).toContain('🇪🇺')
  })

  it('mentions attached file names', () => {
    const withFile: Conversation = {
      ...fakeConv,
      messages: [
        {
          id: 'mf',
          role: 'user',
          content: 'Voici un doc',
          timestamp: 0,
          files: [{ name: 'devis.pdf', type: 'application/pdf', data: '' }],
        },
      ],
    }
    expect(buildConversationMarkdown(withFile)).toContain('devis.pdf')
  })

  it('falls back to a default title when missing', () => {
    const noTitle = { ...fakeConv, title: '' }
    expect(buildConversationMarkdown(noTitle)).toContain('# Conversation Arty')
  })
})

describe('buildConversationHtml', () => {
  it('escapes HTML in user content (XSS guard)', () => {
    const xssConv: Conversation = {
      ...fakeConv,
      messages: [
        {
          id: 'x',
          role: 'user',
          content: '<script>alert(1)</script>',
          timestamp: 0,
        },
      ],
    }
    const html = buildConversationHtml(xssConv)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders bold via **text** -> <strong>', () => {
    const html = buildConversationHtml(fakeConv)
    expect(html).toContain('<strong>Salut !</strong>')
  })

  it('renders inline code via backticks', () => {
    const conv: Conversation = {
      ...fakeConv,
      messages: [
        {
          id: 'c',
          role: 'assistant',
          content: 'Use `npm install`',
          timestamp: 0,
        },
      ],
    }
    const html = buildConversationHtml(conv)
    expect(html).toContain('<code')
    expect(html).toContain('npm install')
  })

  it('escapes filenames in attachments', () => {
    const conv: Conversation = {
      ...fakeConv,
      messages: [
        {
          id: 'f',
          role: 'user',
          content: '',
          timestamp: 0,
          files: [{ name: '<evil>.pdf', type: 'application/pdf', data: '' }],
        },
      ],
    }
    const html = buildConversationHtml(conv)
    expect(html).not.toContain('<evil>.pdf')
    expect(html).toContain('&lt;evil&gt;.pdf')
  })

  it('escapes the title', () => {
    const conv = { ...fakeConv, title: '<b>boom</b>' }
    const html = buildConversationHtml(conv)
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;')
  })
})
