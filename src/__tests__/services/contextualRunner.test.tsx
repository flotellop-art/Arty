import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../types'
import type { PanelConfig } from '../../services/comparator/providerCatalog'
import type { streamMessage } from '../../services/anthropicClient'
import type { useContextualComparisons } from '../../hooks/useContextualComparisons'
import { startContextualComparison, type ContextualFactories } from '../../services/comparator/contextualRunner'
import { captureContextualComparison } from '../../services/comparator/contextualPreparation'
import { ContextualCompareScreen, comparisonPanel } from '../../screens/contextualCompare'
import { useStreaming } from '../../hooks/useStreaming'
import * as storage from '../../services/storage'
import * as files from '../../services/secureFileStorage'
import * as projects from '../../services/projects/store'
import { prepareProjectDocument } from '../../services/projects/documentImport'
import { initCrypto, decrypt } from '../../services/crypto'
import { setActiveSession, getActiveSession, PROJECT_ERASURE_FENCE_KEY } from '../../services/userSession'
import { invalidateLocalDataViews } from '../../services/localDataInvalidation'
import { buildConversationJsonExport, importConversationFromFile } from '../../services/conversationExport'
import { hasProjectHistory } from '../../services/projects/chatPolicy'
import { openDB } from 'idb'
import { useEffect } from 'react'
import { useConversation } from '../../hooks/useConversation'
import { ContextualComparisonDialog } from '../../components/comparator/ContextualComparisonDialog'
import { ProjectReviewDialog } from '../../components/chat/ProjectReviewDialog'
import { MessageList } from '../../components/chat/MessageList'
import { streamMessage as anthropicStream } from '../../services/anthropicClient'
import producerFixtures from '../helpers/office-producer-fixtures.json'
import i18n from '../../i18n'

// Transports, key availability and the plan are faked; setup.ts supplies an
// admitted document lock. Owners/epochs, crypto guards, IndexedDB, extraction,
// preparation, commit, GC, streaming registry and UI are real. Not live auth/billing.
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn() }))
vi.mock('../../services/mistralClient', () => ({ streamMistralMessage: vi.fn() }))
vi.mock('../../services/activeApiKey', () => ({ getAnthropicKey: () => 'server-provided', getMistralKey: () => null, getGeminiKey: () => null, getOpenAIKey: () => null }))
vi.mock('../../hooks/usePlanStatus', () => ({ usePlanStatus: () => ({ plan: 'vip', loading: false, statusUnavailable: false, authRejected: false, authRequired: false,
  allowedFamilies: ['claude-haiku', 'claude-sonnet', 'claude-opus', 'mistral-medium'], lockedFamilies: [], dailyRemaining: null, monthlyCap: null, premiumPackRemaining: 0 }) }))
type Args = Parameters<typeof streamMessage>
type Call = { args: Args; controller: AbortController }
let source: Conversation, calls: Call[]
const panels: PanelConfig[] = [{ id: 'a', provider: 'anthropic', modelId: 'claude-haiku-4-5' }, { id: 'b', provider: 'anthropic', modelId: 'claude-sonnet-5' }]
const review = vi.fn(async (r: Parameters<import('../../services/projects/chatPreparation').ReviewProjectRequest>[0]) =>
  r.kind === 'select' ? { mode: 'overview' as const, documentIds: r.project.documents.map(d => d.id) } : true)
const invoke = (...args: Args) => {
  const controller = new AbortController(); calls.push({ args, controller })
  // Mistral-like done after abort must never overwrite the terminal outcome.
  controller.signal.addEventListener('abort', args[2])
  return controller
}
const clients: ContextualFactories = { claude: invoke, mistral: invoke as ContextualFactories['mistral'] }
const capture = () => captureContextualComparison({ sourceId: source.id, messageId: 'question', signal: new AbortController().signal, isBusy: () => false, getAccess: () => null })
const prep = () => capture().prepare(panels, review)
function registry() { return renderHook(() => useStreaming({ refreshConversations: () => {} })) }
async function start(notify = vi.fn()) {
  const prepared = await prep(), hook = registry()
  let run!: ReturnType<typeof startContextualComparison>
  act(() => { run = startContextualComparison(prepared, hook.result.current, notify, clients) })
  return { run, hook }
}
async function engage(index = 0) { await act(async () => { await calls[index]!.args[4]!.beforeDocumentRequest!() }) }
function page(run: ReturnType<typeof startContextualComparison>, id = run.branchIds[0]) {
  const onChat = vi.fn(), onBack = vi.fn()
  const controller = { readLive: run.read, open: vi.fn() } as unknown as ReturnType<typeof useContextualComparisons>
  const view = render(<MemoryRouter initialEntries={[`/compare/${id}`]}><Routes><Route path="/compare/:branchId" element={<ContextualCompareScreen controller={controller} onChat={onChat} onBack={onBack} onStop={() => {}} />} /></Routes></MemoryRouter>)
  return { ...view, onChat, onBack }
}
beforeEach(async () => {
  vi.restoreAllMocks(); calls = []; review.mockClear(); localStorage.clear(); storage.resetConversationMemCache()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  setActiveSession({ userId: crypto.randomUUID(), authMethod: 'apikey', displayName: 'Synthetic test', createdAt: 1 })
  await initCrypto('contextual-synthetic-test-key')
  await storage.bootstrapConversationStorage()
  source = { id: 'original', title: 'Synthetic project', createdAt: 1, updatedAt: 1,
    messages: [{ id: 'question', role: 'user', content: '中文 Résumer le devis', timestamp: 1 }, { id: 'original-response', role: 'assistant', content: 'ORIGINAL UNCHANGED', timestamp: 2 }] }
  storage.saveConversation(source)
  vi.mocked(anthropicStream).mockImplementation(invoke)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network') }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Contextual vertical — real encrypted stores and shared registry, fake provider only', () => {
  it.each(['done', 'stop', 'crash'] as const)('preserves raw restricted output through the shared %s writer and encrypted reload', async outcome => {
    source.outputRestriction = 'client-reply-draft-v1'; source.hasProjectContext = true
    storage.saveConversation(source)
    const hook = registry()
    act(() => { hook.result.current.startStream(source.id); hook.result.current.onToken('TEXTE MODELE BRUT', source.id); hook.result.current.savePartialAll() })
    expect(storage.getConversation(source.id)!.messages.at(-1)).toMatchObject({ id: 'streaming', content: 'TEXTE MODELE BRUT' })
    if (outcome === 'done') act(() => hook.result.current.onDone(source.id))
    if (outcome === 'stop') act(() => hook.result.current.stopStreaming(source.id))
    hook.unmount()
    await waitFor(async () => {
      const encKey = Object.keys(localStorage).find(k => k.endsWith('conversations-enc'))!
      expect(encKey).toBeTruthy(); expect(Object.keys(localStorage).some(k => k.endsWith('conversations'))).toBe(false)
      expect(await decrypt(localStorage.getItem(encKey)!)).toContain('TEXTE MODELE BRUT')
    })
    storage.resetConversationMemCache(); await storage.bootstrapConversationStorage()
    const c = storage.getConversation(source.id)!
    expect(c.outputRestriction).toBe('client-reply-draft-v1'); expect(c.hasProjectContext).toBe(true)
    expect(c.messages.at(-1)!.content).toBe('TEXTE MODELE BRUT')
    expect(!!c.messages.at(-1)!.interrupted).toBe(outcome !== 'done')
    expect(c.messages.at(-1)!.id).not.toBe('streaming'); expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps restrictions before/after a branch and during a generic retry without injecting fake model tokens', async () => {
    source.outputRestriction = 'client-reply-draft-v1'; source.hasProjectContext = true
    storage.saveConversation(source)
    const hook = renderHook(() => useConversation())
    act(() => hook.result.current.selectConversation(source.id))
    for (const index of [0, 1]) {
      let id: string | null = null
      act(() => { id = hook.result.current.branchConversation(source.id, index) })
      expect(storage.getConversation(id!)!).toMatchObject({ outputRestriction: 'client-reply-draft-v1', hasProjectContext: true })
    }
    act(() => hook.result.current.retryMessage('original-response'))
    await waitFor(() => expect(hook.result.current.projectReview.request?.kind).toBe('confirm'))
    expect(calls).toHaveLength(0)
    act(() => { const r = hook.result.current.projectReview.request!; hook.result.current.projectReview.answer(r.reviewId, true) })
    await waitFor(() => expect(calls).toHaveLength(1)); await engage()
    expect(calls[0]!.args[4]).toMatchObject({ documentReadOnly: true, tools: [] })
    act(() => { calls[0]!.args[1]('NOUVELLE REPONSE BRUTE'); calls[0]!.args[2]() })
    expect(storage.getConversation(source.id)!.messages.at(-1)!.content).toBe('NOUVELLE REPONSE BRUTE')
    expect(storage.getConversation(source.id)!.outputRestriction).toBe('client-reply-draft-v1')
    expect(fetch).not.toHaveBeenCalled(); hook.unmount()
  })
  it('shows two restricted comparison outputs after reload while keeping model metrics/text raw', async () => {
    source.outputRestriction = 'client-reply-draft-v1'; source.hasProjectContext = true
    storage.saveConversation(source)
    const { run, hook } = await start(); await engage(0); await engage(1)
    act(() => { calls[0]!.args[1]('ANSWER A'); calls[0]!.args[2](); calls[1]!.args[1]('PARTIAL B'); calls[1]!.args[3](new Error('Synthetic stop')) })
    for (const [index, id] of run.branchIds.entries()) {
      const c = storage.getConversation(id)!
      expect(c.outputRestriction).toBe('client-reply-draft-v1')
      expect(c.messages.at(-1)!.content).toBe(index ? 'PARTIAL B' : 'ANSWER A')
      expect(run.read(id)!.metrics.outputTokens).toBeLessThan(10)
    }
    hook.unmount(); storage.resetConversationMemCache(); await storage.bootstrapConversationStorage()
    const view = page({ ...run, read: () => null })
    await screen.findByText('Réponse préparée — non envoyée par Arty')
    expect(screen.getByText('Réponse préparée incomplète — non envoyée par Arty')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled(); view.unmount()
  })
  it('actual first-question action, A→B navigation, cancel, confirm, continue, regenerate and detach keep the comparison intact', async () => {
    let chat!: ReturnType<typeof useConversation>
    function Workbench() {
      chat = useConversation()
      useEffect(() => { chat.selectConversation(source.id) }, [])
      const request = chat.projectReview.request
      return <>
        {chat.activeConversation && <MessageList conversationId={chat.activeConversation.id} messages={chat.activeConversation.messages} isStreaming={chat.isStreaming} streamingContent={chat.streamingContent}
          onCompare={id => chat.comparisons.open(chat.activeConversation!.id, id)} />}
        {chat.comparisons.selection && <ContextualComparisonDialog controller={chat.comparisons} onStarted={chat.selectConversation} />}
        {request && <ProjectReviewDialog key={request.reviewId} request={request} onAnswer={answer => chat.projectReview.answer(request.reviewId, answer)} />}
      </>
    }
    const other = { ...source, id: 'other', messages: [{ ...source.messages[0]!, content: 'OTHER QUESTION' }] }
    storage.saveConversation(other)
    const view = render(<Workbench />)
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('compare.context.action') }))
    expect(chat.comparisons.selection!.sourceId).toBe(source.id)
    act(() => chat.selectConversation(other.id))
    expect(chat.comparisons.selection!.question).toBe(source.messages[0]!.content)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(chat.comparisons.selection).toBeNull(); expect(calls).toHaveLength(0)
    act(() => chat.selectConversation(source.id))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('compare.context.action') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('compare.context.prepare') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer les deux appels' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    const firstBranch = chat.activeId!, original = structuredClone(storage.getConversation(source.id))
    await engage(0); await engage(1)
    act(() => { calls[0]!.args[1]('CHOSEN RESPONSE'); calls[0]!.args[2](); calls[1]!.args[3](new Error('Quota')) })
    const compared = structuredClone(storage.getConversation(firstBranch))!
    const responseId = compared.comparison!.responseId
    act(() => chat.retryMessage(responseId))
    await waitFor(() => expect(chat.projectReview.request?.kind).toBe('confirm'))
    expect(chat.activeId).not.toBe(firstBranch)
    const branchedId = chat.activeId!
    expect(storage.getConversation(firstBranch)).toEqual(compared)
    act(() => { const r = chat.projectReview.request!; chat.projectReview.answer(r.reviewId, null) })
    await waitFor(() => expect(chat.projectReview.request).toBeNull())
    expect(calls).toHaveLength(2)
    expect(storage.getConversation(branchedId)!.comparison).toBeUndefined()
    expect(hasProjectHistory(storage.getConversation(branchedId)!)).toBe(true)
    await act(async () => { await chat.setConversationProject(branchedId, null) })
    expect(hasProjectHistory(storage.getConversation(branchedId)!)).toBe(true)
    let send!: Promise<boolean>
    act(() => { send = chat.sendMessage('Nouveau message documentaire', branchedId) })
    await waitFor(() => expect(chat.projectReview.request?.kind).toBe('confirm'))
    act(() => { const r = chat.projectReview.request!; chat.projectReview.answer(r.reviewId, true) })
    await act(async () => { expect(await send).toBe(true) })
    expect(calls).toHaveLength(3); expect(calls[2]!.args[4]).toMatchObject({ documentReadOnly: true, tools: [] })
    await engage(2)
    act(() => { calls[2]!.args[1]('NEW DOCUMENTARY RESPONSE'); calls[2]!.args[2]() })
    expect(storage.getConversation(firstBranch)).toEqual(compared); expect(storage.getConversation(source.id)).toEqual(original)
    expect(fetch).not.toHaveBeenCalled(); view.unmount()
  })
  it('Office + project → cancel → two branches → quota B → encrypted reload → continue A → GC and rehydrate', async () => {
    const op = await projects.beginProjectOperation(), initial = await projects.createProject(op, 'Synthetic library')
    const bytes = new TextEncoder().encode('Surface du chantier : 88 m². Enduit minéral.')
    const doc = await prepareProjectDocument(op, { name: 'source.txt', size: bytes.length, arrayBuffer: async () => bytes.buffer } as File)
    const project = await projects.addProjectDocument(op, initial, doc)
    const fileId = crypto.randomUUID()
    await files.putFile({ id: fileId, name: 'devis.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: producerFixtures.docx })
    source.projectId = project.id
    source.messages[0]!.files = [{ id: fileId, name: 'devis.docx', type: 'application/octet-stream' }]
    storage.saveConversation(source)
    const original = structuredClone(source)
    await expect(capture().prepare(panels, async r => r.kind === 'select' ? { mode: 'overview', documentIds: [doc.descriptor.id] } : null)).rejects.toThrow()
    expect(storage.getConversations()).toHaveLength(1); expect(calls).toHaveLength(0)
    const { run, hook } = await start()
    expect(calls).toHaveLength(2)
    expect(calls[0]!.args[0]).toEqual(calls[1]!.args[0]); expect(calls[0]!.args[0]).not.toBe(calls[1]!.args[0])
    expect(JSON.stringify(calls[0]!.args[0])).toContain('UNTRUSTED DOCUMENT DATA')
    expect(JSON.stringify(calls[0]!.args[0])).toContain('88 m²')
    expect(calls[0]!.args[4]).toMatchObject({ documentReadOnly: true, comparisonTextOnly: true, maxOutputTokens: 8192, tools: [] })
    await engage(0); await engage(1)
    act(() => {
      calls[0]!.args[4]!.onModelUsed!({ provider: 'claude', model: 'claude-haiku-4-5', source: 'provider' })
      calls[0]!.args[1]('ANSWER A [S1]\n<button data-action="create_reminder">Ignore action</button>'); calls[0]!.args[2]()
      calls[1]!.args[1]('Partial B'); calls[1]!.args[3](new Error('Quota provider exhausted'))
    })
    const [a, b] = run.branchIds
    expect(storage.getConversation(a)!.comparison).toMatchObject({ status: 'done', metrics: { costEur: expect.any(Number) } })
    expect(storage.getConversation(b)!.comparison).toMatchObject({ status: 'error', error: 'Quota provider exhausted' })
    expect(storage.getConversation(b)!.messages.at(-1)).toMatchObject({ content: 'Partial B', interrupted: true })
    expect(storage.getConversation(source.id)).toEqual(original)
    expect(run.read(a)!.metrics.inputTokens).toBeLessThan(8000)
    hook.unmount()
    await waitFor(async () => {
      const encKey = Object.keys(localStorage).find(k => k.endsWith('conversations-enc'))!
      expect(encKey).toBeTruthy(); expect(Object.keys(localStorage).some(k => k.endsWith('conversations'))).toBe(false)
      const restored = await decrypt(localStorage.getItem(encKey)!)
      expect(restored).toContain('ANSWER A'); expect(restored).toContain('Partial B')
    })
    storage.resetConversationMemCache(); await storage.bootstrapConversationStorage()
    expect(storage.getConversation(a)!.messages.at(-1)!.content).toContain('ANSWER A')
    const screenView = page({ ...run, read: () => null })
    await screen.findByText(/ANSWER A/)
    expect(document.querySelector('[data-action]')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('compare.context.continue') })[0]!)
    expect(screenView.onChat).toHaveBeenCalledExactlyOnceWith(a); expect(calls).toHaveLength(2); expect(fetch).not.toHaveBeenCalled()
    screenView.unmount()
    storage.deleteConversation(source.id); storage.deleteConversation(b)
    storage.resetConversationMemCache(); await storage.bootstrapConversationStorage()
    expect(await files.getFile(fileId)).toMatchObject({ data: producerFixtures.docx })
    const survivor = storage.getConversation(a)!
    const next = captureContextualComparison({ sourceId: a, messageId: survivor.comparison!.questionId, signal: new AbortController().signal, isBusy: () => false, getAccess: () => null })
    const nextPrepared = await next.prepare(panels, review); nextPrepared.commit()
    expect(JSON.stringify(nextPrepared.takeRequest(0).claudeMessages)).toContain('UNTRUSTED DOCUMENT DATA')
    expect(hasProjectHistory(survivor)).toBe(true); expect(fetch).not.toHaveBeenCalled()
  })
  it('two shared slots must be available before any branch commit or client call', async () => {
    const prepared = await prep(), hook = registry()
    act(() => { hook.result.current.startStream('normal-1'); hook.result.current.startStream('normal-2') })
    act(() => expect(() => startContextualComparison(prepared, hook.result.current, () => {}, clients)).toThrow('compare.context.concurrent'))
    expect(storage.getConversations()).toHaveLength(1); expect(calls).toHaveLength(0)
    expect(hook.result.current.streamingConvIds.size).toBe(2)
  })
  it('binary context never displays a priced cost or tokenizes its base64', async () => {
    const id = crypto.randomUUID()
    await files.putFile({ id, name: 'pixel.png', type: 'image/png', width: 1, height: 1, size: 68, normalizationVersion: 2,
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJm0AAAAASUVORK5CYII=' })
    source.messages[0]!.files = [{ id, name: 'pixel.png', type: 'image/png' }]; storage.saveConversation(source)
    const { run } = await start(); await engage()
    act(() => { calls[0]!.args[4]!.onModelUsed!({ provider: 'claude', model: 'claude-haiku-4-5', source: 'provider' }); calls[0]!.args[1]('Pixel'); calls[0]!.args[2]() })
    expect(run.read(run.branchIds[0])!.binaryBytes).toBeGreaterThan(0)
    expect(run.read(run.branchIds[0])!.metrics.costEur).toBeNull()
    expect(run.read(run.branchIds[0])!.metrics.inputTokens).toBeLessThan(1000)
  })
  it('cold boot failure is bounded and provides a no-network way back', async () => {
    const { run } = await start(); act(() => run.cancel())
    vi.spyOn(storage, 'isCacheReady').mockReturnValue(false)
    vi.useFakeTimers()
    try {
      const view = page(run)
      expect(screen.getByText(i18n.t('compare.context.loading'))).toBeTruthy()
      act(() => { window.dispatchEvent(new Event('conversations-storage-ready')); vi.advanceTimersByTime(10_001) })
      expect(screen.getByText(i18n.t('compare.context.unavailable'))).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: i18n.t('compare.back') }))
      expect(view.onBack).toHaveBeenCalledTimes(1); expect(calls).toHaveLength(2); expect(fetch).not.toHaveBeenCalled()
      view.unmount()
    } finally { vi.useRealTimers() }
  })
  it('initial local quota failure releases both slots without HTTP or phantom branches', async () => {
    const prepared = await prep(), hook = registry(), originalSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.endsWith('conversations')) throw new DOMException('Full', 'QuotaExceededError')
      originalSet.call(this, key, value)
    })
    act(() => expect(() => startContextualComparison(prepared, hook.result.current, () => {}, clients)).toThrow())
    expect(hook.result.current.streamingConvIds.size).toBe(0); expect(storage.getConversations()).toHaveLength(1); expect(calls).toHaveLength(0)
  })
  it('Stop with zero tokens is durable and late done/token cannot overwrite or release a replacement slot', async () => {
    const { run, hook } = await start(), a = run.branchIds[0]
    act(() => hook.result.current.stopStreaming(a))
    expect(storage.getConversation(a)!.comparison!.status).toBe('aborted')
    expect(storage.getConversation(a)!.messages).toHaveLength(1)
    expect(calls[0]!.controller.signal.aborted).toBe(true)
    act(() => { hook.result.current.startStream(a); calls[0]!.args[1]('LATE'); calls[0]!.args[2]() })
    expect(hook.result.current.hasStream(a)).toBe(true); expect(JSON.stringify(storage.getConversation(a))).not.toContain('LATE')
  })
  it.each(['pagehide', 'unmount'] as const)('%s persists received text with one fixed response id', async event => {
    const { run, hook } = await start(), a = run.branchIds[0]; await engage()
    act(() => calls[0]!.args[1]('Partial survived'))
    if (event === 'pagehide') act(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('pagehide')) })
    else hook.unmount()
    const result = storage.getConversation(a)!
    expect(result.messages).toHaveLength(2); expect(result.messages.at(-1)).toMatchObject({ id: result.comparison!.responseId, content: 'Partial survived', interrupted: true })
    expect(comparisonPanel(result)!.status).toBe('aborted')
  })
  it('final local quota failure exposes unsaved full text and stops only that panel', async () => {
    const { run, hook } = await start(), a = run.branchIds[0]; await engage()
    const originalSet = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.endsWith('conversations') && value.includes('LAST TOKEN')) throw new DOMException('Full', 'QuotaExceededError')
      originalSet.call(this, key, value)
    })
    act(() => { calls[0]!.args[1]('LAST TOKEN'); calls[0]!.args[2]() })
    expect(run.read(a)).toMatchObject({ text: 'LAST TOKEN', saved: false, status: 'error', error: 'compare.context.notSaved' })
    expect(hook.result.current.hasStream(a)).toBe(false); expect(hook.result.current.hasStream(run.branchIds[1])).toBe(true)
    expect(JSON.stringify(storage.getConversation(a))).not.toContain('LAST TOKEN')
  })
  it('UI observer exceptions after save cannot falsify a successful commit receipt', async () => {
    const { run } = await start(() => { throw new Error('observer failed') }); await engage()
    act(() => { calls[0]!.args[1]('SAVED'); calls[0]!.args[2]() })
    expect(run.read(run.branchIds[0])).toMatchObject({ saved: true, status: 'done', text: 'SAVED' })
  })
  it('explicit discard hides live state even while the account and branch are still valid', async () => {
    const { run, hook } = await start(), a = run.branchIds[0]
    act(() => hook.result.current.discardStream(a))
    expect(run.read(a)).toBeNull(); expect(hook.result.current.hasStream(a)).toBe(false)
    expect(storage.getConversation(a)!.comparison!.status).toBe('pending')
  })
  it('settlement refreshes server usage once only after engagement, never for stale/discarded invocations', async () => {
    const refresh = vi.fn(); window.addEventListener('arty-message-sent', refresh)
    try {
      const { run, hook } = await start(); await engage(0)
      act(() => { calls[0]!.args[3](new Error('Quota')); calls[0]!.args[2](); hook.result.current.stopStreaming(run.branchIds[1]) })
      expect(refresh).toHaveBeenCalledTimes(1)
      const second = await start(); await engage(2)
      act(() => invalidateLocalDataViews())
      act(() => { calls[2]!.args[2](); second.run.cancel() })
      expect(refresh).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('arty-message-sent', refresh) }
  })
  it('same-identity initial key readiness can finish after route mount, without reviving a captured scope', async () => {
    const { run } = await start(); await engage()
    act(() => { calls[0]!.args[1]('BOOT RESULT'); calls[0]!.args[2]() })
    const ready = vi.spyOn(storage, 'isCacheReady').mockReturnValue(false)
    page({ ...run, read: () => null })
    expect(screen.getByText(i18n.t('compare.context.loading'))).toBeTruthy()
    await act(async () => { await initCrypto('contextual-synthetic-test-key') })
    ready.mockRestore()
    act(() => window.dispatchEvent(new Event('conversations-storage-ready')))
    await screen.findByText('BOOT RESULT')
    await act(async () => { await initCrypto('contextual-synthetic-test-key') })
    expect(screen.queryByText('BOOT RESULT')).toBeNull()
  })
  it.each(['crypto', 'aba', 'fence', 'known'] as const)('%s invalidation prevents post-auth gates, callbacks and durable writes', async change => {
    const { run, hook } = await start(), a = run.branchIds[0], before = JSON.stringify(storage.getConversation(a))
    await act(async () => {
      if (change === 'crypto') await initCrypto('contextual-synthetic-test-key')
      if (change === 'aba') { const old = getActiveSession()!; setActiveSession({ ...old, userId: 'another' }); setActiveSession(old) }
      if (change === 'fence') localStorage.setItem(PROJECT_ERASURE_FENCE_KEY, 'rotated')
      if (change === 'known') localStorage.setItem('arty-known-sessions', '[]')
    })
    await expect(calls[0]!.args[4]!.beforeDocumentRequest!()).rejects.toThrow()
    act(() => { calls[0]!.args[1]('PRIVATE LATE'); calls[0]!.args[2](); hook.result.current.savePartialAll() })
    expect(run.read(a)).toBeNull(); expect(JSON.stringify(storage.getConversation(a))).not.toContain('PRIVATE LATE')
    if (change !== 'aba') expect(JSON.stringify(storage.getConversation(a))).toBe(before)
  })
  it('a durable fence changed without storage event still blocks the real beforeRequest gate', async () => {
    const { run } = await start()
    const op = await projects.beginProjectOperation(); op.assertCurrent()
    const db = await openDB('arty-projects', 1); await db.put('meta', 'other', 'erasure-fence')
    try { await expect(calls[0]!.args[4]!.beforeDocumentRequest!()).rejects.toThrow() }
    finally { await db.delete('meta', 'erasure-fence'); db.close(); act(() => run.cancel()) }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('same-owner crypto invalidation removes the already rendered warm-cache result', async () => {
    const { run } = await start(); await engage()
    act(() => { calls[0]!.args[1]('SECRET RESULT'); calls[0]!.args[2]() })
    page(run); await screen.findByText('SECRET RESULT')
    await act(async () => { await initCrypto('contextual-synthetic-test-key') })
    await waitFor(() => expect(screen.queryByText('SECRET RESULT')).toBeNull())
    expect(screen.getByText(i18n.t('compare.context.unavailable'))).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['missing', 'nonreciprocal', 'old-model'] as const)('reopened UI remains truthful for %s metadata', async mode => {
    const { run } = await start(); await engage(0); await engage(1)
    act(() => { calls[0]!.args[1]('SURVIVOR'); calls[0]!.args[2](); calls[1]!.args[1]('PEER'); calls[1]!.args[2]() })
    const [a, b] = run.branchIds
    if (mode === 'missing') { storage.deleteConversation(source.id); storage.deleteConversation(b) }
    if (mode === 'nonreciprocal') { const peer = structuredClone(storage.getConversation(b))!; peer.comparison!.peerId = 'foreign'; storage.saveConversation(peer) }
    if (mode === 'old-model') { const value = structuredClone(storage.getConversation(a))!; value.comparison!.requestedModel = 'historical-model-retired'; storage.saveConversation(value) }
    const view = page({ ...run, read: () => null })
    await screen.findByText('SURVIVOR')
    if (mode === 'old-model') expect(screen.getByRole('option', { name: 'historical-model-retired' })).toBeTruthy()
    else { expect(screen.getByText(i18n.t('compare.context.peerMissing'))).toBeTruthy(); expect(screen.queryByText('PEER')).toBeNull() }
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('compare.context.continue') })[0]!)
    expect(view.onChat).toHaveBeenCalledExactlyOnceWith(a); expect(calls).toHaveLength(2); expect(fetch).not.toHaveBeenCalled()
  })
  it('export/import drops grouping without re-enabling document actions', async () => {
    const { run } = await start(); await engage()
    act(() => { calls[0]!.args[1]('<button data-action="create_reminder">inert</button>'); calls[0]!.args[2]() })
    const branch = storage.getConversation(run.branchIds[0])!, exported = buildConversationJsonExport(branch)
    expect(JSON.stringify(exported)).not.toContain('comparison')
    const text = JSON.stringify(exported)
    await importConversationFromFile({ size: text.length, text: async () => text } as File)
    const imported = storage.getConversations().find(c => ![source.id, ...run.branchIds].includes(c.id))!
    expect(imported.comparison).toBeUndefined(); expect(hasProjectHistory(imported)).toBe(true)
    act(() => invalidateLocalDataViews())
  })
})
