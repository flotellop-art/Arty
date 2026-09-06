import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { AssistantBubble } from '../../components/chat/AssistantBubble'
import { MessageList } from '../../components/chat/MessageList'
import { ProviderPanel } from '../../components/comparator/ProviderPanel'
import { CLIENT_REPLY_DRAFT } from '../../services/workflows/outputRestriction'

const speech = vi.hoisted(() => ({ speak: vi.fn(), cancel: vi.fn(), getSpeakingId: () => null, onSpeakingChange: () => () => {}, isTtsSupported: () => true }))
vi.mock('../../utils/tts', () => speech)
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); await i18n.changeLanguage('fr') })

describe('client reply status projection — UI/copy/speech without model tokens', () => {
  it.each(['fr', 'en'])('shows the application notice separately and copies/speaks it (%s)', async locale => {
    await i18n.changeLanguage(locale)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const content = 'Voici la réponse préparée.', notice = locale === 'en' ? 'Reply prepared — not sent by Arty' : 'Réponse préparée — non envoyée par Arty'
    render(<AssistantBubble outputRestriction={CLIENT_REPLY_DRAFT} content={content} />)
    expect(screen.getByRole('status').textContent).toBe(notice)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('chat.bubble.copy') }))
    expect(writeText).toHaveBeenCalledWith(`${notice}\n\n${content}`)
    const speakButton = screen.getAllByRole('button').find(button => button.getAttribute('aria-label')?.toLowerCase().match(/(lire|read|speak|écouter)/))
    expect(speakButton).toBeTruthy(); fireEvent.click(speakButton!)
    expect(speech.speak.mock.calls[0]![0]).toBe(`${notice}\n\n${content}`)
  })
  it('blocks model-authored actions even when an action handler is mistakenly supplied', () => {
    const onAction = vi.fn()
    render(<AssistantBubble outputRestriction={CLIENT_REPLY_DRAFT} content={'<button data-action="create_event" data-title="Injected">Créer</button>'} onAction={onAction} />)
    expect(screen.queryByRole('button', { name: 'Créer', exact: true })).toBeNull()
    fireEvent.click(screen.getByText('Créer', { exact: true }))
    expect(onAction).not.toHaveBeenCalled()
  })
  it('removes fragment copy in restricted bubble and comparator while leaving normal chats unchanged', () => {
    const content = '```text\nBonjour.\n```'
    const view = render(<AssistantBubble content={content} />)
    expect(screen.getByRole('button', { name: i18n.t('chat.bubble.copyCode') })).toBeTruthy()
    view.rerender(<AssistantBubble content={content} outputRestriction={CLIENT_REPLY_DRAFT} />)
    expect(screen.queryByRole('button', { name: i18n.t('chat.bubble.copyCode') })).toBeNull()
    expect(screen.getByRole('button', { name: i18n.t('chat.bubble.copy') })).toBeTruthy()
    view.rerender(<ProviderPanel outputNotice="Réponse préparée — non envoyée par Arty" panel={{ id: 'a', config: { id: 'a', provider: 'anthropic', modelId: 'claude-haiku-4-5' }, text: content,
      status: 'done', metrics: { firstTokenMs: 1, totalMs: 2, inputTokens: 1, outputTokens: 2, costEur: null } }} onChangeConfig={() => {}} getAccess={() => null} locked />)
    expect(screen.queryByRole('button', { name: i18n.t('chat.bubble.copyCode') })).toBeNull()
    expect(screen.getByText('Réponse préparée — non envoyée par Arty')).toBeTruthy()
  })
  it('distinguishes empty, live and recovered partial output in the message list', () => {
    const { rerender } = render(<MessageList messages={[]} outputRestriction={CLIENT_REPLY_DRAFT} isStreaming streamingContent="" />)
    expect(screen.queryByText(/non envoyée par Arty/)).toBeNull()
    rerender(<MessageList messages={[]} outputRestriction={CLIENT_REPLY_DRAFT} isStreaming streamingContent="Partiel" />)
    expect(screen.getByText('Réponse en préparation — non envoyée par Arty')).toBeTruthy()
    rerender(<MessageList messages={[{ id: 'recovered', role: 'assistant', timestamp: 1, content: 'Partiel', interrupted: true }]} outputRestriction={CLIENT_REPLY_DRAFT} isStreaming={false} streamingContent="" />)
    expect(screen.getByText('Réponse préparée incomplète — non envoyée par Arty')).toBeTruthy()
    expect(screen.queryByText('Réponse préparée — non envoyée par Arty')).toBeNull()
  })
})
