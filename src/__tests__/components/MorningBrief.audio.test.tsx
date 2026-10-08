import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ current: true, finish: vi.fn(), speech: vi.fn(), token: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../utils/formatDate', () => ({ getDateLocale: () => 'fr-FR' }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mocks.token }))
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/conversationWork', () => ({ beginConversationWork: () => mocks.finish }))
vi.mock('../../services/calendarClient', () => ({
  listEvents: async () => [],
  captureCalendarContext: (signal: AbortSignal) => {
    const assertCurrent = () => {
      if (!mocks.current || signal.aborted) throw new Error('Expired synthetic scope')
    }
    return { assertCurrent, validateReadOnly: async () => assertCurrent() }
  },
}))
vi.mock('../../services/morningBriefService', () => ({
  markBriefShown: vi.fn(), scheduleMorningNotification: vi.fn(),
  getGreeting: () => 'Bonjour', formatEventTime: () => '',
  buildBriefSpeechText: mocks.speech,
}))
import { MorningBrief } from '../../components/home/MorningBrief'

let audios: SyntheticAudio[]
let fetcher: ReturnType<typeof vi.fn>
let revoke: ReturnType<typeof vi.fn>
let create: ReturnType<typeof vi.fn>
class SyntheticAudio extends EventTarget {
  private source: string
  get src() { return this.source }
  set src(value: string) {
    this.source = value
    if (!value) this.dispatchEvent(new Event('error'))
  }
  play = vi.fn(async () => { this.dispatchEvent(new Event('playing')) })
  pause = vi.fn(() => { this.dispatchEvent(new Event('pause')) })
  constructor(src: string) { super(); this.source = src; audios.push(this) }
}
const button = () => screen.getByRole('button', { name: 'morningBrief.player.listen' })
const mount = (strict = false) => {
  const brief = <MorningBrief onClose={vi.fn()} onSend={vi.fn()} userName="Synthetic" isGoogleConnected />
  return render(strict ? <StrictMode>{brief}</StrictMode> : brief)
}
const start = async () => {
  fireEvent.click(button())
  await screen.findByRole('button', { name: 'morningBrief.player.pause' })
  return audios.at(-1)!
}
beforeEach(() => {
  mocks.current = true; mocks.speech.mockResolvedValue('Bonjour. Brief synthetique.')
  mocks.token.mockReset(); mocks.token.mockResolvedValue('synthetic-token')
  mocks.finish.mockClear(); audios = []
  fetcher = vi.fn(async () => new Response('synthetic-mp3', { headers: { 'content-type': 'audio/mpeg' } }))
  vi.stubGlobal('fetch', fetcher); vi.stubGlobal('Audio', SyntheticAudio)
  create = vi.fn(() => `blob:brief-${audios.length + 1}`); revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('MorningBrief audio ownership (synthetic media, not device acceptance)', () => {
  it.each([false, true])('keeps a successful new audio across the React update (StrictMode=%s)', async strict => {
    mount(strict)
    const audio = await start()
    expect(audio.src).toBe('blob:brief-1')
    expect(audio.pause).not.toHaveBeenCalled()
    expect(revoke).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('pauses and resumes the same audio without generating another brief', async () => {
    mount(); const audio = await start()
    fireEvent.click(screen.getByRole('button', { name: 'morningBrief.player.pause' }))
    await screen.findByRole('button', { name: 'morningBrief.player.listen' })
    fireEvent.click(button())
    await screen.findByRole('button', { name: 'morningBrief.player.pause' })
    expect(audio.play).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledOnce()
    expect(audio.src).toBe('blob:brief-1'); expect(revoke).not.toHaveBeenCalled()
  })
  it('releases finished audio once and ignores its events during the next playback', async () => {
    const { unmount } = mount(); const first = await start()
    act(() => first.dispatchEvent(new Event('ended')))
    expect(first.src).toBe(''); expect(revoke.mock.calls).toEqual([['blob:brief-1']])
    const second = await start()
    act(() => {
      for (const type of ['pause', 'error', 'ended', 'playing']) first.dispatchEvent(new Event(type))
    })
    expect(screen.getByRole('button', { name: 'morningBrief.player.pause' })).toBeInTheDocument()
    expect(screen.queryByText('morningBrief.player.errorGeneric')).toBeNull()
    expect(second.src).toBe('blob:brief-2')
    unmount(); expect(revoke.mock.calls).toEqual([['blob:brief-1'], ['blob:brief-2']])
    expect(second.src).toBe('')
  })
  it('releases playback on close and on account invalidation without revoking twice', async () => {
    const { unmount } = mount(); const audio = await start()
    act(() => { mocks.current = false; window.dispatchEvent(new Event('google-storage-ready')) })
    expect(audio.src).toBe(''); expect(revoke).toHaveBeenCalledOnce()
    expect(screen.getByText('calendarWorkflow.reopenBrief')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button')[0]!)
    unmount(); expect(revoke).toHaveBeenCalledOnce()
  })
  it.each(['unmount', 'account'] as const)('does not create audio after a late response and %s', async change => {
    let resolve!: (response: Response) => void
    fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
    const { unmount } = mount(); fireEvent.click(button())
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    if (change === 'unmount') unmount()
    else act(() => { mocks.current = false; window.dispatchEvent(new Event('google-storage-ready')) })
    await act(async () => resolve(new Response('late-mp3')))
    expect(audios).toHaveLength(0); expect(create).not.toHaveBeenCalled()
    if (change === 'account') expect(screen.getByText('calendarWorkflow.reopenBrief')).toBeInTheDocument()
  })
  it('releases an audio that fails to decode and allows a fresh attempt', async () => {
    mount(); const first = await start()
    act(() => first.dispatchEvent(new Event('error')))
    expect(screen.getByText('morningBrief.player.errorGeneric')).toBeInTheDocument()
    expect(first.src).toBe(''); expect(revoke).toHaveBeenCalledOnce()
    const second = await start(); expect(second.src).toBe('blob:brief-2')
  })
  it.each([[401, 'error401'], [429, 'error429'], [502, 'error502'], [503, 'errorGeneric']] as const)(
    'preserves the HTTP %s error without creating audio', async (status, message) => {
      fetcher.mockResolvedValueOnce(new Response('{}', { status }))
      mount(); fireEvent.click(button())
      await screen.findByText(`morningBrief.player.${message}`)
      expect(audios).toHaveLength(0); expect(create).not.toHaveBeenCalled()
    },
  )
  it.each(['initial', 'resume'] as const)('releases audio when %s play rejects', async stage => {
    mount()
    if (stage === 'initial') {
      vi.stubGlobal('Audio', class extends SyntheticAudio {
        constructor(src: string) { super(src); this.play.mockRejectedValueOnce(new DOMException('Playback refused', 'NotAllowedError')) }
      })
      fireEvent.click(button())
    } else {
      const audio = await start()
      fireEvent.click(screen.getByRole('button', { name: 'morningBrief.player.pause' }))
      audio.play.mockRejectedValueOnce(new DOMException('Playback refused', 'NotAllowedError'))
      fireEvent.click(button())
    }
    await screen.findByText('morningBrief.player.errorGeneric')
    expect(audios[0]!.src).toBe(''); expect(revoke).toHaveBeenCalledOnce()
  })
  it('ignores a late play rejection from an audio that has already finished', async () => {
    let reject!: (error: Error) => void
    vi.stubGlobal('Audio', class extends SyntheticAudio {
      constructor(src: string) {
        super(src)
        if (audios.length === 1) this.play.mockImplementationOnce(() => {
          this.dispatchEvent(new Event('playing'))
          return new Promise<void>((_done, fail) => { reject = fail })
        })
      }
    })
    mount(); const first = await start()
    act(() => first.dispatchEvent(new Event('ended')))
    const second = await start()
    await act(async () => reject(new Error('Obsolete playback')))
    expect(screen.getByRole('button', { name: 'morningBrief.player.pause' })).toBeInTheDocument()
    expect(screen.queryByText('morningBrief.player.errorGeneric')).toBeNull()
    expect(second.src).toBe('blob:brief-2')
  })
  it('admits only one generation for rapid taps before authentication resolves', async () => {
    let resolve!: (token: string) => void
    mocks.token.mockReturnValueOnce(new Promise<string>(done => { resolve = done }))
    mount(); fireEvent.click(button()); fireEvent.click(button())
    expect(mocks.token).toHaveBeenCalledOnce()
    await act(async () => resolve('synthetic-token'))
    await screen.findByRole('button', { name: 'morningBrief.player.pause' })
    expect(fetcher).toHaveBeenCalledOnce(); expect(audios).toHaveLength(1)
  })
})
