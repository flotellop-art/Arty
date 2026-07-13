import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBar } from '../../components/layout/InputBar'
import i18n from '../../i18n'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: { label?: string }) =>
      key === 'chat.input.chipSuggestion'
        ? `Suggestion: ${options?.label ?? ''}`
        : key,
  }),
}))

vi.mock('../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    interimTranscript: '',
    error: null,
    isSupported: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('../../services/native/platform', () => ({ isNative: false }))
vi.mock('../../services/native/camera', () => ({
  takePhoto: vi.fn(async () => null),
  scanDocument: vi.fn(async () => null),
}))
vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => null),
}))
vi.mock('../../services/googleApiHelper', () => ({ callGoogleApi: vi.fn() }))
vi.mock('../../services/promptEnhancer', () => ({
  enhancePrompt: vi.fn(),
  canEnhancePrompt: vi.fn(() => false),
}))
vi.mock('../../services/promptEnhancerSettings', () => ({
  isPromptEnhancementEnabled: vi.fn(() => false),
}))
vi.mock('../../services/aiRouter', () => ({ hasUrl: vi.fn(() => false) }))
vi.mock('../../services/activeApiKey', () => ({ hasOpenAIKey: vi.fn(() => false) }))
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn(async () => undefined) }))
vi.mock('../../components/chat/ReflectionPill', () => ({
  ReflectionPill: () => <span>reflection-pill</span>,
}))

function renderInput(v2: boolean, onSend = vi.fn()) {
  localStorage.setItem('arty-inputbar-v2', v2 ? '1' : '0')
  render(<InputBar onSend={onSend} isStreaming={false} />)
  return { onSend }
}

async function summarizeButton() {
  return screen.findByRole('button', {
    name: 'Suggestion: chat.input.chips.summarize.label',
  })
}

describe.each([
  ['v2', true],
  ['legacy', false],
] as const)('InputBar actions rapides — %s', (_label, v2) => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
    vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14)
  })

  afterEach(() => {
    cleanup()
    localStorage.removeItem('arty-inputbar-v2')
    vi.restoreAllMocks()
  })

  it('arme l\'action sans envoyer, puis transmet séparément le texte visible', async () => {
    const { onSend } = renderInput(v2)
    const chip = await summarizeButton()
    const textarea = screen.getByPlaceholderText('chat.input.placeholder')

    fireEvent.click(chip)

    expect(onSend).not.toHaveBeenCalled()
    expect(textarea).toHaveValue('')
    expect(chip).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(textarea, { target: { value: 'Le texte saisi par le user' } })
    expect(textarea).toHaveValue('Le texte saisi par le user')
    expect((textarea as HTMLTextAreaElement).value).not.toContain('Résume-moi')

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith(
      'Le texte saisi par le user',
      undefined,
      { quickAction: { id: 'summarize', locale: 'fr' } },
    )
    expect(textarea).toHaveValue('')
  })

  it('consomme l\'action une seule fois après l\'envoi', async () => {
    const { onSend } = renderInput(v2)
    fireEvent.click(await summarizeButton())

    const textarea = screen.getByPlaceholderText('chat.input.placeholder')
    fireEvent.change(textarea, { target: { value: 'Premier texte' } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))

    fireEvent.change(textarea, { target: { value: 'Message suivant' } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2))
    expect(onSend).toHaveBeenNthCalledWith(2, 'Message suivant', undefined, undefined)
  })

  it('permet d\'annuler par un second clic et de remplacer par une autre action', async () => {
    const { onSend } = renderInput(v2)
    const summarize = await summarizeButton()
    const translate = screen.getByRole('button', {
      name: 'Suggestion: chat.input.chips.translate.label',
    })

    fireEvent.click(summarize)
    fireEvent.click(summarize)
    expect(summarize).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(summarize)
    fireEvent.click(translate)
    expect(summarize).toHaveAttribute('aria-pressed', 'false')
    expect(translate).toHaveAttribute('aria-pressed', 'true')

    const textarea = screen.getByPlaceholderText('chat.input.placeholder')
    fireEvent.change(textarea, { target: { value: 'Bonjour tout le monde' } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))

    expect(onSend).toHaveBeenCalledWith(
      'Bonjour tout le monde',
      undefined,
      { quickAction: { id: 'translate', locale: 'fr' } },
    )
  })
})
