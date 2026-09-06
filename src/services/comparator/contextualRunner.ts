import type { useStreaming, ExternalStreamLease } from '../../hooks/useStreaming'
import type { captureContextualComparison, ContextualComparison } from './contextualPreparation'
import { streamMessage } from '../anthropicClient'
import { streamMistralMessage } from '../mistralClient'
import * as storage from '../storage'
import { projectPayloadBudget } from '../projects/chatPreparation'
import { estimateTokens, estimateCostEur } from './tokenEstimator'
import { findModel } from './providerCatalog'
import { validModelId, type ModelUsedEvent } from '../modelLabels'
import type { PanelState } from './useMultiProviderChat'
import type { ClaudeSubModel } from '../aiRouter'

type Prepared = Awaited<ReturnType<ReturnType<typeof captureContextualComparison>['prepare']>>
type Request = ReturnType<Prepared['takeRequest']>
export type ComparisonLivePanel = PanelState & { saved: boolean; binaryBytes: number }
export type ContextualFactories = { claude: typeof streamMessage; mistral: typeof streamMistralMessage }
const factories: ContextualFactories = { claude: streamMessage, mistral: streamMistralMessage }
type Registry = Pick<ReturnType<typeof useStreaming>, 'reserveExternalStreams'>

/** No separate concurrency registry. Every request occupies the chat's actual
 * StreamState; only result persistence differs, because a comparison has a
 * stable response ID and must report commit failure separately from HTTP. */
export function startContextualComparison(prepared: Prepared, registry: Registry, publish: () => void,
  clients: ContextualFactories = factories) {
  prepared.assertCurrent()
  const notify = () => { try { publish() } catch { /* A UI observer is not the durable commit. */ } }
  const panels = [0, 1].map(() => ({ request: undefined as Request | undefined, lease: undefined as ExternalStreamLease | undefined,
    controller: undefined as AbortController | undefined, timer: undefined as ReturnType<typeof setTimeout> | undefined,
    settled: false, discarded: false, engaged: false, view: undefined as ComparisonLivePanel | undefined, start: performance.now(), firstToken: null as number | null }))
  const current = (index: number) => {
    const p = panels[index]!
    if (p.settled || !p.lease?.isCurrent()) throw new DOMException('Comparison cancelled', 'AbortError')
    p.request?.assertCurrent()
  }
  const metrics = (index: number, terminal = false) => {
    const p = panels[index]!, view = p.view!
    const costKey = view.attribution && view.attribution.source !== 'requested' ? findModel(view.config.provider, view.attribution.model)?.costKey : undefined
    return { ...view.metrics, firstTokenMs: p.firstToken, totalMs: terminal ? Math.round(performance.now() - p.start) : null,
      outputTokens: estimateTokens(view.text), costEur: costKey && !view.binaryBytes ? estimateCostEur(costKey, view.metrics.inputTokens, estimateTokens(view.text)) : null }
  }
  const persist = (index: number): boolean => {
    const p = panels[index]!, view = p.view!, request = p.request!
    try {
      current(index)
      const old = storage.getConversation(request.branchId)
      if (!old?.comparison || !storage.isCacheReady()) return false
      const comparison: ContextualComparison = { ...old.comparison, status: view.status === 'idle' ? 'pending' : view.status,
        metrics: { ...view.metrics }, binaryBytes: view.binaryBytes, ...(view.error ? { error: view.error.slice(0, 1200) } : {}),
        ...(view.attribution ? { attribution: { ...view.attribution } } : {}) }
      const messages = old.messages.filter(m => m.id !== comparison.responseId)
      // No placeholder before HTTP: attribution is emitted before async auth.
      // Empty error/aborted outcomes live in metadata and still commit.
      if (view.text || view.status === 'done') messages.push({ id: comparison.responseId, role: 'assistant', content: view.text,
        timestamp: Date.now(), projectTurn: structuredClone(request.turn), ...(view.status !== 'done' ? { interrupted: true } : {}),
        requestedModel: view.config.modelId, ...(view.attribution ? { model: view.attribution.model, modelSource: view.attribution.source } : {}) })
      storage.saveConversation({ ...old, messages, comparison, updatedAt: Date.now() })
      view.saved = true; notify(); return true
    } catch { return false }
  }
  const finish = (index: number, status: 'done' | 'error' | 'aborted', error?: string, discard = false) => {
    const p = panels[index]!
    if (p.settled) return
    try {
      current(index)
      if (!discard && p.view) {
        p.view.status = status; p.view.error = error; p.view.metrics = metrics(index, true)
        if (!persist(index)) { p.view.saved = false; p.view.status = 'error'; p.view.error = 'compare.context.notSaved'; notify() }
      }
    } catch { /* Invalid scope: no persistence or stale UI publication. */ }
    // Close callbacks before abort (some transports synchronously call done).
    p.settled = true; p.discarded = discard; clearTimeout(p.timer)
    if (discard) p.view = undefined
    try { p.controller?.abort() } catch { /* Continue cleanup for both panels. */ } finally { p.lease?.release() }
    if (p.engaged && !discard) {
      try { p.request?.assertCurrent(); window.dispatchEvent(new Event('arty-message-sent')) } catch { /* No refresh into an invalidated scope. */ }
    }
  }
  const leases = registry.reserveExternalStreams(panels.map((_, index) => ({ id: prepared.branchIds[index]!,
    assertCurrent: () => { const p = panels[index]!; if (p.request) p.request.assertCurrent(); else prepared.assertCurrent() },
    lifecycle: {
      flush: () => {
        const p = panels[index]!
        if (p.settled || !p.view) return true
        if (persist(index)) return true
        finish(index, 'error', 'compare.context.notSaved'); return false
      },
      cancel: (reason: 'stop' | 'discard' | 'unmount') => finish(index, 'aborted', undefined, reason === 'discard'),
    },
  })))
  if (!leases) throw new Error('compare.context.concurrent')
  leases.forEach((lease, index) => { panels[index]!.lease = lease })
  try {
    prepared.commit()
    panels.forEach((p, index) => {
      p.request = prepared.takeRequest(index as 0 | 1)
      const budget = projectPayloadBudget(p.request.claudeMessages ?? p.request.mistralMessages, p.request.systemPrompt)
      // Exclude binary bytes, but include the actual text/roles/structure and
      // CJK characters. The preparer's fixed safety reserve is not sent here.
      const textPayload = JSON.stringify(p.request.claudeMessages ?? p.request.mistralMessages, function (key, value) {
        if (key === 'source' && ['image', 'document'].includes(this.type)) return { ...value, data: undefined }
        if (key === 'image_url' && this.type === 'image_url') return { ...value, url: undefined }
        return value
      }) + p.request.systemPrompt
      p.view = { id: p.request.branchId, config: { ...p.request.config, id: p.request.branchId }, text: '', status: 'streaming', saved: true,
        binaryBytes: budget.binaryBytes, metrics: { firstTokenMs: null, totalMs: null, inputTokens: estimateTokens(textPayload), outputTokens: 0, costEur: null } }
    })
  } catch (error) { panels.forEach((_, i) => finish(i, 'aborted', undefined, true)); throw error }
  panels.forEach((p, index) => {
    const request = p.request!
    const onToken = (token: string) => {
      try { current(index); if (!p.engaged) throw new Error('Response before consent gate') }
      catch { finish(index, 'error', 'compare.context.cancelled'); return }
      p.firstToken ??= Math.round(performance.now() - p.start)
      p.view!.text += token
      if (p.view!.text.length > 200_000) { p.view!.text = p.view!.text.slice(0, 200_000); finish(index, 'aborted', 'compare.context.outputLimit'); return }
      p.view!.metrics = metrics(index); p.view!.saved = false; notify()
    }
    const onError = (error: Error) => finish(index, 'error', error.message)
    const options = { documentReadOnly: true, comparisonTextOnly: true, maxOutputTokens: 8192, background: true, systemPrompt: request.systemPrompt,
      model: request.config.modelId, tools: [], euOnly: request.provider === 'mistral', webSearch: false,
      assertRequestCurrent: () => current(index),
      beforeDocumentRequest: async () => { current(index); await request.beforeRequest(); current(index); p.engaged = true },
      onModelUsed: (event: ModelUsedEvent) => {
        try { current(index) } catch { return }
        if (!validModelId(event.model) || !['requested', 'proxy', 'provider'].includes(event.source ?? '')) return
        p.view!.attribution = { model: event.model, source: event.source, provider: request.provider, requestedModel: request.config.modelId }
        p.view!.metrics = metrics(index); notify()
      },
    }
    p.timer = setTimeout(() => finish(index, 'error', 'compare.timeout'), 120_000)
    try {
      const done = () => finish(index, p.engaged ? 'done' : 'error', p.engaged ? undefined : 'compare.context.cancelled')
      p.controller = request.provider === 'claude'
        ? clients.claude(request.claudeMessages!, onToken, done, onError, { ...options, model: options.model as ClaudeSubModel })
        : clients.mistral(request.mistralMessages!, onToken, done, onError, options)
      if (p.settled) p.controller.abort()
    } catch (error) { onError(error instanceof Error ? error : new Error('Comparison failed')) }
  })
  notify()
  return { branchIds: prepared.branchIds,
    read(id: string): ComparisonLivePanel | null {
      const p = panels.find(p => p.request?.branchId === id)
      if (!p?.view || !p.request || p.discarded) return null
      try { p.request.assertCurrent(); return structuredClone(p.view) } catch { return null }
    },
    cancel() { panels.forEach((_, i) => finish(i, 'aborted')) },
  }
}
