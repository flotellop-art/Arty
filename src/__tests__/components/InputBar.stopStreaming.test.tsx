import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InputBar } from '../../components/layout/InputBar'
import { useStreaming } from '../../hooks/useStreaming'
import type { Conversation } from '../../types'

const fixture = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn() }))
vi.mock('../../services/storage', () => ({ isCacheReady: () => true, getConversation: fixture.read, saveConversation: fixture.save }))
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../hooks/useSpeechRecognition', () => ({ useSpeechRecognition: () => ({ isListening: false, interimTranscript: '', error: null, isSupported: false, startListening: vi.fn(), stopListening: vi.fn() }) }))
vi.mock('../../services/native/platform', () => ({ isNative: false }))
vi.mock('../../services/native/camera', () => ({ takePhoto: vi.fn(), scanDocument: vi.fn() }))
vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn(async () => null) }))
vi.mock('../../services/googleApiHelper', () => ({ callGoogleApi: vi.fn() }))
vi.mock('../../services/promptEnhancer', () => ({ enhancePrompt: vi.fn(), canEnhancePrompt: () => false }))
vi.mock('../../services/promptEnhancerSettings', () => ({ isPromptEnhancementEnabled: () => false }))
vi.mock('../../services/aiRouter', () => ({ hasUrl: () => false }))
vi.mock('../../services/activeApiKey', () => ({ hasOpenAIKey: () => false }))
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }))
vi.mock('../../components/chat/ReflectionPill', () => ({ ReflectionPill: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.read.mockImplementation((id: string): Conversation => ({ id, title: 'Synthetic', messages: [], createdAt: 1, updatedAt: 1 }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe.each(['default', 'hero'] as const)('InputBar Stop DOM boundary — %s', variant => {
  it('stops only the displayed stream through the real callback and preserves its partial', () => {
    let stream!: ReturnType<typeof useStreaming>
    const onSend = vi.fn(), refreshConversations = vi.fn()
    function Harness() {
      stream = useStreaming({ refreshConversations })
      // Same direct callback passed by App. Wrapping here would conceal the regression.
      return <InputBar onSend={onSend} isStreaming={stream.isStreaming} onStop={stream.stopStreaming} variant={variant} showQuickActions={false} />
    }
    render(<Harness />)
    const active = new AbortController(), background = new AbortController(), aborted = vi.fn()
    active.signal.addEventListener('abort', aborted)
    act(() => {
      stream.setActiveStream('displayed'); stream.startStream('displayed'); stream.startStream('background')
      stream.setAbortController('displayed', active); stream.setAbortController('background', background)
      stream.onToken('Partiel conservé — été', 'displayed')
    })
    fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.stop' }))
    expect(active.signal.aborted).toBe(true); expect(aborted).toHaveBeenCalledOnce()
    expect(fixture.save).toHaveBeenCalledOnce()
    expect(fixture.save.mock.calls[0][0]).toMatchObject({ id: 'displayed', messages: [{ role: 'assistant', content: 'Partiel conservé — été', interrupted: true }] })
    expect(stream.hasStream('displayed')).toBe(false); expect(stream.hasStream('background')).toBe(true)
    expect(background.signal.aborted).toBe(false); expect(screen.queryByRole('button', { name: 'chat.input.aria.stop' })).not.toBeInTheDocument()
    act(() => { stream.onToken('Late old fragment', 'displayed'); stream.onDone('displayed'); stream.onError(new Error('Late old error'), 'displayed') })
    expect(fixture.save).toHaveBeenCalledOnce(); expect(onSend).not.toHaveBeenCalled()
  })
  it('keeps the optional callback optional', () => {
    render(<InputBar onSend={vi.fn()} isStreaming variant={variant} />)
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'chat.input.aria.stop' }))).not.toThrow()
  })
})
