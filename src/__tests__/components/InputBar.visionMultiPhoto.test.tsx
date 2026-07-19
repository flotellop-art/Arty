import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBar } from '../../components/layout/InputBar'

const visionMocks = vi.hoisted(() => ({
  normalizeImageForVision: vi.fn(),
}))

vi.mock('../../services/imageNormalization', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/imageNormalization')>()),
  normalizeImageForVision: visionMocks.normalizeImageForVision,
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.name === 'string') return `${key}:${options.name}`
      if (key === 'chat.input.routePreview') return `${key}:${String(options?.provider ?? '')}`
      return key
    },
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
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(async () => null) }))
vi.mock('../../services/googleApiHelper', () => ({ callGoogleApi: vi.fn() }))
vi.mock('../../services/promptEnhancer', () => ({
  enhancePrompt: vi.fn(),
  canEnhancePrompt: vi.fn(() => false),
}))
vi.mock('../../services/promptEnhancerSettings', () => ({
  isPromptEnhancementEnabled: vi.fn(() => false),
}))
vi.mock('../../services/aiRouter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/aiRouter')>()),
  hasUrl: vi.fn(() => false),
}))
vi.mock('../../services/activeApiKey', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/activeApiKey')>()),
  hasOpenAIKey: vi.fn(() => false),
  getGeminiKey: vi.fn(() => null),
  getMistralKey: vi.fn(() => null),
  getOpenAIKey: vi.fn(() => null),
}))
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn(async () => undefined) }))
vi.mock('../../components/chat/ReflectionPill', () => ({ ReflectionPill: () => null }))

function image(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
}

function asset(index: number, size = 1024 * 1024) {
  return {
    data: `canonical-${index}`,
    mimeType: 'image/jpeg' as const,
    size,
    width: 4096,
    height: 3072,
    normalizationVersion: 2,
  }
}

function canonicalAttachment(name = 'chantier.jpg') {
  return {
    id: `canonical-${name}`,
    name,
    type: 'image/jpeg',
    data: 'AA==',
    size: 1024,
    width: 4096,
    height: 3072,
    normalizationVersion: 2,
  }
}

function multipleInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"][multiple]')
  if (!(input instanceof HTMLInputElement)) throw new Error('multiple file input missing')
  return input
}

function asFileList(files: File[]): FileList {
  return Object.assign(files, {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList
}

describe('InputBar — lots de photos 4K', () => {
  beforeEach(() => {
    localStorage.setItem('arty-vision-terra-4k-foundation', '1')
    localStorage.setItem('arty-vision-terra-auto-routing', '1')
    localStorage.setItem('arty-inputbar-v2', '1')
    localStorage.setItem('arty-ai-model', 'auto')
    localStorage.setItem('arty-plan-cache', 'subscription')
    localStorage.setItem('arty-allowed-families', JSON.stringify(['gpt-full']))
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.removeItem('arty-vision-terra-4k-foundation')
    localStorage.removeItem('arty-vision-terra-auto-routing')
    localStorage.removeItem('arty-inputbar-v2')
    localStorage.removeItem('arty-ai-model')
    localStorage.removeItem('arty-plan-cache')
    localStorage.removeItem('arty-allowed-families')
    localStorage.removeItem('arty-trial-remaining')
    localStorage.removeItem('arty-wallet-available')
    visionMocks.normalizeImageForVision.mockReset()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('normalise un FileList séquentiellement, conserve son ordre et envoie les trois assets', async () => {
    let active = 0
    let peak = 0
    let index = 0
    visionMocks.normalizeImageForVision.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      index += 1
      return asset(index)
    })
    const onSend = vi.fn()
    const { container } = render(<InputBar onSend={onSend} isStreaming={false} />)

    fireEvent.change(multipleInput(container), {
      target: { files: asFileList([image('une.jpg'), image('deux.jpg'), image('trois.jpg')]) },
    })

    await screen.findByText('trois.jpg')
    expect(peak).toBe(1)
    expect(visionMocks.normalizeImageForVision).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    expect(onSend).toHaveBeenCalledTimes(1)
    const sentFiles = onSend.mock.calls[0]?.[1]
    expect(sentFiles?.map((file: { name: string }) => file.name)).toEqual([
      'une.jpg',
      'deux.jpg',
      'trois.jpg',
    ])
    expect(sentFiles?.every((file: { normalizationVersion?: number }) => file.normalizationVersion === 2)).toBe(true)
    expect(new Set(sentFiles?.map((file: { id: string }) => file.id)).size).toBe(3)
  })

  it('refuse la cinquième photo avant décodage', async () => {
    visionMocks.normalizeImageForVision.mockImplementation(async () => asset(1))
    const onSend = vi.fn()
    const { container } = render(<InputBar onSend={onSend} isStreaming={false} />)

    fireEvent.change(multipleInput(container), {
      target: { files: asFileList(['1', '2', '3', '4', '5'].map((value) => image(`${value}.jpg`))) },
    })

    await waitFor(() => expect(visionMocks.normalizeImageForVision).toHaveBeenCalledTimes(4))
    expect(await screen.findByText('chat.input.tooManyImages')).toBeInTheDocument()
    expect(screen.queryByText('5.jpg')).not.toBeInTheDocument()
  })

  it('garde une défense si un asset hors contrat faisait dépasser 16 Mio', async () => {
    let index = 0
    visionMocks.normalizeImageForVision.mockImplementation(async () => {
      index += 1
      return asset(index, index === 4 ? 5 * 1024 * 1024 : 4 * 1024 * 1024)
    })
    const { container } = render(<InputBar onSend={vi.fn()} isStreaming={false} />)

    fireEvent.change(multipleInput(container), {
      target: { files: asFileList(['1', '2', '3', '4'].map((value) => image(`${value}.jpg`))) },
    })

    expect(await screen.findByText('chat.input.imageBatchTooLarge')).toBeInTheDocument()
    expect(screen.queryByText('4.jpg')).not.toBeInTheDocument()
    expect(visionMocks.normalizeImageForVision).toHaveBeenCalledTimes(4)
  })

  it('accepte exactement 16 Mio pour quatre photos 4K', async () => {
    let index = 0
    visionMocks.normalizeImageForVision.mockImplementation(async () => {
      index += 1
      return asset(index, 4 * 1024 * 1024)
    })
    const onSend = vi.fn()
    const { container } = render(<InputBar onSend={onSend} isStreaming={false} />)

    fireEvent.change(multipleInput(container), {
      target: { files: asFileList(['1', '2', '3', '4'].map((value) => image(`${value}.jpg`))) },
    })

    await screen.findByText('4.jpg')
    expect(screen.queryByText('chat.input.imageBatchTooLarge')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    expect(onSend.mock.calls[0]?.[1]).toHaveLength(4)
  })

  it('laisse un PDF seul sur le chemin historique sans état photo', async () => {
    const onSend = vi.fn()
    const { container } = render(<InputBar onSend={onSend} isStreaming={false} />)
    const pdf = new File([new TextEncoder().encode('pdf')], 'devis.pdf', { type: 'application/pdf' })

    fireEvent.change(multipleInput(container), { target: { files: asFileList([pdf]) } })

    await screen.findByText('devis.pdf')
    expect(visionMocks.normalizeImageForVision).not.toHaveBeenCalled()
    expect(screen.queryByText('chat.input.preparingImage')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.send' }))
    expect(onSend.mock.calls[0]?.[1]?.[0]).toMatchObject({
      name: 'devis.pdf',
      type: 'application/pdf',
      data: 'cGRm',
    })
  })

  it('annonce Terra avant envoi pour un lot photo canonique éligible', () => {
    render(
      <InputBar
        onSend={vi.fn()}
        isStreaming={false}
        initialFiles={[canonicalAttachment()]}
      />,
    )

    expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('chat.input.optimized4k')
    expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent(
      'chat.input.routePreview:chat.input.routeProvider.terra',
    )
  })

  it('recalcule la destination quand le plan change sans toucher aux photos', async () => {
    render(
      <InputBar
        onSend={vi.fn()}
        isStreaming={false}
        initialFiles={[canonicalAttachment()]}
      />,
    )
    expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('routeProvider.terra')

    localStorage.setItem('arty-plan-cache', 'free')
    localStorage.setItem('arty-allowed-families', JSON.stringify(['claude-haiku']))
    act(() => window.dispatchEvent(new CustomEvent('arty-plan-status-changed')))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('routeProvider.claude')
    })
  })

  it('recalcule la destination quand le trial expire et le wallet prend le relais', async () => {
    localStorage.setItem('arty-plan-cache', 'free')
    localStorage.setItem('arty-allowed-families', JSON.stringify(['gpt-full']))
    localStorage.setItem('arty-wallet-available', '1000000')
    localStorage.setItem('arty-trial-remaining', '2')
    render(
      <InputBar
        onSend={vi.fn()}
        isStreaming={false}
        initialFiles={[canonicalAttachment()]}
      />,
    )
    expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('routeProvider.claude')

    localStorage.setItem('arty-trial-remaining', '0')
    act(() => window.dispatchEvent(new CustomEvent('arty-trial-remaining-changed')))

    await waitFor(() => {
      expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('routeProvider.terra')
    })
  })

  it('recalcule la destination au changement de modèle et respecte l’historique privé', async () => {
    const { rerender } = render(
      <InputBar
        onSend={vi.fn()}
        isStreaming={false}
        initialFiles={[canonicalAttachment()]}
      />,
    )
    expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('routeProvider.terra')

    localStorage.setItem('arty-ai-model', 'claude')
    act(() => window.dispatchEvent(new CustomEvent('model-changed')))
    await waitFor(() => {
      expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('routeProvider.claude')
    })

    localStorage.setItem('arty-ai-model', 'auto')
    rerender(
      <InputBar
        onSend={vi.fn()}
        isStreaming={false}
        initialFiles={[canonicalAttachment()]}
        hasPrivateHistory
      />,
    )
    expect(screen.getByTestId('attachment-route-preview')).toHaveTextContent('routeProvider.claude')
  })

  it('désactive ajout, suppression et envoi pendant une normalisation longue', async () => {
    let release!: (value: ReturnType<typeof asset>) => void
    visionMocks.normalizeImageForVision.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))
    const { container } = render(
      <InputBar
        onSend={vi.fn()}
        isStreaming={false}
        initialText="Analyse-les"
        initialFiles={[{
          id: 'already-there',
          name: 'existante.jpg',
          type: 'image/jpeg',
          data: 'legacy',
          size: 10,
        }]}
      />,
    )

    fireEvent.change(multipleInput(container), { target: { files: asFileList([image('nouvelle.jpg')]) } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'chat.input.menu.file' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'chat.input.aria.send' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'chat.input.removeFile:existante.jpg' })).toBeDisabled()
    })

    release(asset(1))
    await screen.findByText('nouvelle.jpg')
    expect(screen.getByRole('button', { name: 'chat.input.menu.file' })).toBeEnabled()
  })
})
