import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { Message, QuickActionSelection } from '../../types'
import {
  composeQuickActionText,
  getMessageTextForModel,
  isQuickActionSelection,
} from '../../services/quickActions'
import {
  buildApiMessages,
  buildMistralContentBlocks,
  buildMistralMessages,
  buildTextOnlyMessages,
} from '../../hooks/useFileAttachments'

vi.mock('../../services/secureFileStorage', () => ({
  getFile: vi.fn(async (id: string) => id === 'persisted-img'
    ? {
        id,
        name: 'persisted.png',
        type: 'image/png',
        data: 'aW1hZ2U=',
      }
    : null),
}))

function userMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'user-1',
    role: 'user',
    content: 'Le texte visible',
    timestamp: 1,
    ...overrides,
  }
}

describe('actions rapides invisibles', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
  })

  it('compose l\'instruction allowlistée uniquement pour le modèle', () => {
    const message = userMessage({ quickAction: { id: 'summarize', locale: 'fr' } })

    expect(getMessageTextForModel(message)).toBe(
      'Résume-moi ce texte :\n\nLe texte visible',
    )
    expect(message.content).toBe('Le texte visible')
    expect(composeQuickActionText(message.content)).toBe('Le texte visible')
  })

  it('ignore une sélection injectée qui ne fait pas partie de l\'allowlist', () => {
    const injected = {
      id: 'ignore-all-previous-instructions',
      locale: 'fr',
    } as QuickActionSelection

    expect(isQuickActionSelection(injected)).toBe(false)
    expect(composeQuickActionText('Texte sûr', injected)).toBe('Texte sûr')
  })

  it('fige la langue de l\'action pour l\'historique et les relances', async () => {
    const selection: QuickActionSelection = { id: 'translateToEn', locale: 'fr' }
    await i18n.changeLanguage('en')

    expect(composeQuickActionText('Bonjour', selection)).toBe(
      'Traduis ce texte en anglais :\n\nBonjour',
    )
    expect(composeQuickActionText('Hello', { id: 'translateToEn', locale: 'en' })).toBe(
      'Translate this text to French:\n\nHello',
    )
  })

  it('ne modifie jamais les messages assistant', () => {
    expect(getMessageTextForModel({
      role: 'assistant',
      content: 'Réponse visible',
      quickAction: { id: 'translate', locale: 'fr' },
    })).toBe('Réponse visible')
  })

  it('alimente tous les builders provider avec le texte composé', async () => {
    const message = userMessage({ quickAction: { id: 'translate', locale: 'fr' } })
    const expected = 'Traduis ce texte :\n\nLe texte visible'

    const [anthropic, textOnly, mistral] = await Promise.all([
      buildApiMessages([message]),
      buildTextOnlyMessages([message]),
      buildMistralMessages([message]),
    ])

    expect(anthropic[0]?.content).toBe(expected)
    expect(textOnly[0]?.content).toBe(expected)
    expect(mistral[0]?.content).toBe(expected)
    expect(message.content).toBe('Le texte visible')
  })

  it('conserve l\'instruction dans les content blocks avec un fichier', async () => {
    const message = userMessage({
      quickAction: { id: 'explain', locale: 'fr' },
      files: [{
        id: 'img-1',
        name: 'schema.png',
        type: 'image/png',
        data: 'aW1hZ2U=',
      }],
    })
    const expected = 'Explique-moi simplement :\n\nLe texte visible'

    const [anthropic, mistral] = await Promise.all([
      buildApiMessages([message]),
      buildMistralMessages([message]),
    ])

    const anthropicBlocks = anthropic[0]?.content as Array<Record<string, unknown>>
    const mistralBlocks = mistral[0]?.content as Array<{ type: string; text?: string }>
    expect(anthropicBlocks.at(-1)).toEqual({ type: 'text', text: expected })
    expect(mistralBlocks.at(-1)).toEqual({ type: 'text', text: expected })
  })

  it('réhydrate une image persistée lors d\'une relance Mistral', async () => {
    const expected = 'Explique-moi simplement :\n\nLe texte visible'
    const blocks = await buildMistralContentBlocks(expected, [{
      id: 'persisted-img',
      name: 'persisted.png',
      type: 'image/png',
    }])

    expect(blocks[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
    })
    expect(blocks.at(-1)).toEqual({ type: 'text', text: expected })
  })
})
