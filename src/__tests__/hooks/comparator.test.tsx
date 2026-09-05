import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMultiProviderChat, type StreamFactory, type StreamFactories } from '../../services/comparator/useMultiProviderChat'
import { SideBySideChat } from '../../components/comparator/SideBySideChat'
import type { PanelConfig } from '../../services/comparator/providerCatalog'
import type { ModelUsedEvent } from '../../services/modelLabels'
vi.mock('../../services/userSession', () => ({ getActiveUserId: vi.fn(() => 'owner-a'), getActiveSessionEpoch: vi.fn(() => 1) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../components/shared/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p> }))
import { getActiveSessionEpoch } from '../../services/userSession'
const initialPanels: PanelConfig[] = [
  { id: 'one', provider: 'anthropic', modelId: 'claude-sonnet-5' },
  { id: 'two', provider: 'anthropic', modelId: 'claude-haiku-4-5' },
]
type Call = { token: (s: string) => void; done: () => void; error: (e: Error) => void; options: Record<string, unknown>; controller: AbortController }
let calls: Call[], factories: StreamFactories
beforeEach(() => {
  vi.mocked(getActiveSessionEpoch).mockReturnValue(1)
  calls = []
  const factory: StreamFactory = (_m, token, done, error, options) => {
    const controller = new AbortController()
    calls.push({ token, done, error, options: options!, controller }); return controller
  }
  factories = { anthropic: vi.fn(factory), gemini: vi.fn(factory), mistral: vi.fn(factory), openai: vi.fn(factory) }
})
afterEach(() => { cleanup(); vi.useRealTimers() })
const report = (call: Call, model: string) => (call.options.onModelUsed as (e: ModelUsedEvent) => void)({ model, provider: 'claude', source: 'provider', confirmed: true })
const mount = (getAccess: (c: PanelConfig) => string | null = () => null) => renderHook(() => useMultiProviderChat({ initialPanels, factories, getAccess }))
describe('Comparator invocation lifecycle', () => {
  it('real selection changes the dispatched provider/model and clears the previous answer', async () => {
    render(<SideBySideChat initialPanels={initialPanels} factories={factories} getAccess={() => null} onBack={() => {}} />)
    fireEvent.change(screen.getByLabelText('compare.promptLabel'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByLabelText('compare.sendAria'))
    act(() => { calls[0]!.token('OLD'); calls.forEach(c => c.done()) })
    expect(screen.getByText('OLD')).toBeInTheDocument()
    fireEvent.change(screen.getAllByLabelText('compare.provider')[0]!, { target: { value: 'openai' } })
    expect(screen.queryByText('OLD')).not.toBeInTheDocument()
    fireEvent.change(screen.getAllByLabelText('compare.model')[0]!, { target: { value: 'gpt-5-mini' } })
    fireEvent.click(screen.getByLabelText('compare.sendAria'))
    expect(factories.openai).toHaveBeenCalledTimes(1)
    expect(calls[2]!.options.model).toBe('gpt-5-mini')
    act(() => calls.slice(2).forEach(c => c.done()))
  })
  it('separates two same-provider reports and computes cost only from a known reported model', async () => {
    const { result } = mount(); let done!: Promise<void>
    act(() => { done = result.current.send('Hello') })
    act(() => { calls[0]!.token('one'); calls[1]!.token('two'); report(calls[1]!, 'claude-haiku-4-5'); report(calls[0]!, 'new-unknown-model') })
    expect(result.current.panels[0]!.attribution?.model).toBe('new-unknown-model')
    expect(result.current.panels[0]!.metrics.costEur).toBeNull()
    expect(result.current.panels[1]!.metrics.costEur).toBeGreaterThan(0)
    await act(async () => { calls.forEach(c => c.done()); await done })
  })
  it('Stop resolves send and late old callbacks cannot overwrite or stop a new run', async () => {
    const { result } = mount(); let first!: Promise<void>, second!: Promise<void>
    act(() => { first = result.current.send('first') })
    await act(async () => { result.current.cancel(); await first })
    expect(calls[0]!.controller.signal.aborted).toBe(true)
    act(() => { second = result.current.send('second') })
    act(() => { calls[0]!.token('late'); report(calls[0]!, 'claude-opus-4-8'); calls[0]!.done(); calls[1]!.error(new Error('old')); calls[2]!.token('fresh') })
    expect(result.current.panels[0]!.text).toBe('fresh')
    expect(result.current.panels[0]!.attribution).toBeUndefined()
    expect(calls[2]!.controller.signal.aborted).toBe(false)
    await act(async () => { result.current.cancel(); await second })
    expect(calls[2]!.controller.signal.aborted).toBe(true)
  })
  it('clears and aborts on session epoch change even when owner ID stays equal', async () => {
    vi.useFakeTimers(); const { result } = mount(); let done!: Promise<void>
    act(() => { done = result.current.send('private'); calls[0]!.token('secret') })
    act(() => { vi.mocked(getActiveSessionEpoch).mockReturnValue(2); calls[0]!.token('late'); vi.advanceTimersByTime(250) })
    await act(async () => { await done })
    expect(result.current.panels.every(p => p.text === '' && p.status === 'idle')).toBe(true)
    expect(calls.every(c => c.controller.signal.aborted)).toBe(true)
  })
  it('unmount resolves every outstanding promise and invalidates request guards', async () => {
    const { result, unmount } = mount(); let done!: Promise<void>
    act(() => { done = result.current.send('hello') }); unmount(); await done
    expect(calls.every(c => c.controller.signal.aborted)).toBe(true)
    expect(() => (calls[0]!.options.assertRequestCurrent as () => void)()).toThrow()
  })
  it('a new owner run before the session tick is not cancelled by the old owner', async () => {
    vi.useFakeTimers(); const { result } = mount(); let done!: Promise<void>
    act(() => { void result.current.send('A') })
    act(() => { vi.mocked(getActiveSessionEpoch).mockReturnValue(2); done = result.current.send('B') })
    act(() => { vi.advanceTimersByTime(250) })
    expect(calls.slice(2).every(c => !c.controller.signal.aborted)).toBe(true)
    expect(result.current.panels.every(p => p.status === 'streaming')).toBe(true)
    await act(async () => { result.current.cancel(); await done })
  })
  it('never dispatches an ineligible panel', async () => {
    const { result } = mount(() => 'compare.access.byok')
    await act(async () => { await result.current.send('hello') })
    expect(calls).toHaveLength(0)
    expect(result.current.panels.every(p => p.status === 'error')).toBe(true)
  })
  it('bounds a silent client and releases the run', async () => {
    vi.useFakeTimers(); const { result } = mount(); let done!: Promise<void>
    act(() => { done = result.current.send('hello') })
    await act(async () => { vi.advanceTimersByTime(120_000); await done })
    expect(result.current.panels.every(p => p.error === 'compare.timeout')).toBe(true)
    expect(calls.every(c => c.controller.signal.aborted)).toBe(true)
  })
  it('Pro with only OpenAI starts with two eligible submodels; add stays eligible', () => {
    render(<SideBySideChat factories={factories} getAccess={c => c.provider === 'openai' ? null : 'compare.access.byok'} onBack={() => {}} />)
    expect(screen.getAllByLabelText('compare.provider').map(e => (e as HTMLSelectElement).value)).toEqual(['openai', 'openai'])
    fireEvent.click(screen.getByLabelText('compare.addPanelAria'))
    expect(screen.getAllByLabelText('compare.provider').map(e => (e as HTMLSelectElement).value)).toEqual(['openai', 'openai', 'openai'])
    expect(screen.getByLabelText('compare.addPanelAria')).toBeDisabled()
  })
})
