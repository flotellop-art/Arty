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

describe('InputBar — préremplissage éditorial', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
    localStorage.setItem('arty-inputbar-v2', '1')
  })

  afterEach(() => {
    cleanup()
    localStorage.removeItem('arty-inputbar-v2')
    vi.restoreAllMocks()
  })

  it('préremplit et focalise le champ sans envoyer automatiquement', async () => {
    const onSend = vi.fn()
    const { rerender } = render(
      <InputBar onSend={onSend} isStreaming={false} showQuickActions={false} />,
    )

    rerender(
      <InputBar
        onSend={onSend}
        isStreaming={false}
        showQuickActions={false}
        prefill={{ id: 1, text: 'Prépare un ordre du jour concis.' }}
      />,
    )

    const textarea = screen.getByPlaceholderText('chat.input.placeholder')
    await waitFor(() => expect(textarea).toHaveValue('Prépare un ordre du jour concis.'))
    await waitFor(() => expect(textarea).toHaveFocus())
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Suggestion:/ })).not.toBeInTheDocument()
  })

  it('ne remplace pas une modification utilisateur tant que la requête garde le même id', async () => {
    const onSend = vi.fn()
    const { rerender } = render(
      <InputBar
        onSend={onSend}
        isStreaming={false}
        prefill={{ id: 7, text: 'Texte proposé' }}
      />,
    )
    const textarea = screen.getByPlaceholderText('chat.input.placeholder')
    await waitFor(() => expect(textarea).toHaveValue('Texte proposé'))

    fireEvent.change(textarea, { target: { value: 'Texte proposé et modifié' } })
    rerender(
      <InputBar
        onSend={onSend}
        isStreaming={false}
        prefill={{ id: 7, text: 'Texte proposé' }}
      />,
    )

    expect(textarea).toHaveValue('Texte proposé et modifié')
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('InputBar — finition Fable du hero', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
    localStorage.setItem('arty-inputbar-v2', '1')
  })

  afterEach(() => {
    cleanup()
    localStorage.removeItem('arty-inputbar-v2')
    vi.restoreAllMocks()
  })

  it('utilise une surface galet douce qui reste contenue sur mobile', () => {
    render(<InputBar onSend={vi.fn()} isStreaming={false} showQuickActions={false} variant="hero" />)

    const textarea = screen.getByPlaceholderText('chat.input.placeholder')
    expect(textarea.parentElement).toHaveClass(
      'rounded-[24px]',
      'max-[639px]:rounded-[20px]',
      'border-theme-ink/10',
    )
  })
})

describe('InputBar — brouillons', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
    localStorage.setItem('arty-inputbar-v2', '1')
  })

  afterEach(() => {
    cleanup()
    localStorage.removeItem('arty-inputbar-v2')
    vi.restoreAllMocks()
  })

  it('conserve le texte quand le parent refuse la création de conversation', () => {
    const onSend = vi.fn(() => false)
    render(<InputBar onSend={onSend} isStreaming={false} draftKey="refused-send" />)
    const textarea = screen.getByPlaceholderText('chat.input.placeholder')

    fireEvent.change(textarea, { target: { value: 'Brouillon à ne pas perdre' } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(textarea).toHaveValue('Brouillon à ne pas perdre')
  })

  it('conserve aussi le texte après un refus asynchrone du flux', async () => {
    const onSend = vi.fn(async () => false)
    render(<InputBar onSend={onSend} isStreaming={false} draftKey="async-refused-send" />)
    const textarea = screen.getByPlaceholderText('chat.input.placeholder')

    fireEvent.change(textarea, { target: { value: 'Message pendant deux autres streams' } })
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(textarea).toHaveValue('Message pendant deux autres streams'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'chat.input.aria.send' })).toBeEnabled())
  })

  it('restaure un brouillon après remount puis le retire après un envoi accepté', async () => {
    const first = render(<InputBar onSend={vi.fn()} isStreaming={false} draftKey="route-draft" />)
    fireEvent.change(screen.getByPlaceholderText('chat.input.placeholder'), {
      target: { value: 'Texte conservé entre deux écrans' },
    })
    first.unmount()

    const second = render(<InputBar onSend={vi.fn(() => true)} isStreaming={false} draftKey="route-draft" />)
    const restored = screen.getByPlaceholderText('chat.input.placeholder')
    expect(restored).toHaveValue('Texte conservé entre deux écrans')

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    await waitFor(() => expect(restored).toHaveValue(''))
    second.unmount()

    render(<InputBar onSend={vi.fn()} isStreaming={false} draftKey="route-draft" />)
    expect(screen.getByPlaceholderText('chat.input.placeholder')).toHaveValue('')
  })
})
