import { useCallback, useEffect, useRef, useState } from 'react'
import { findModel, type PanelConfig } from './providerCatalog'
import { estimateTokens, estimateCostEur } from './tokenEstimator'
import { validModelId, type ModelUsedEvent } from '../modelLabels'
import { getActiveUserId, getActiveSessionEpoch } from '../userSession'
import { beginConversationWork } from '../conversationWork'

export type StreamFactory = (
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void, onDone: () => void, onError: (e: Error) => void,
  options?: Record<string, unknown>, apiKeyOverride?: string,
) => AbortController
export type StreamFactories = Record<PanelConfig['provider'], StreamFactory>
export interface PanelMetrics {
  firstTokenMs: number | null; totalMs: number | null
  inputTokens: number; outputTokens: number; costEur: number | null
}
export interface PanelState {
  id: string; config: PanelConfig; text: string
  status: 'idle' | 'streaming' | 'done' | 'error' | 'aborted'
  error?: string; metrics: PanelMetrics; attribution?: ModelUsedEvent
}
const emptyMetrics = (): PanelMetrics => ({ firstTokenMs: null, totalMs: null, inputTokens: 0, outputTokens: 0, costEur: null })
const initialState = (config: PanelConfig): PanelState => ({ id: config.id, config, text: '', status: 'idle', metrics: emptyMetrics() })
type Pending = { controller?: AbortController; settle: () => void }
export interface UseMultiProviderChatOptions {
  factories: StreamFactories; initialPanels?: PanelConfig[]
  getAccess: (config: PanelConfig) => string | null
}

export function useMultiProviderChat(opts: UseMultiProviderChatOptions) {
  const [panels, setPanelsState] = useState<PanelState[]>(() => (opts.initialPanels ?? []).map(initialState))
  const configs = useRef(opts.initialPanels ?? [])
  const options = useRef(opts); options.current = opts
  const pending = useRef(new Map<string, Pending>())
  const generation = useRef(0)
  const owner = useRef({ id: getActiveUserId(), epoch: getActiveSessionEpoch() })
  const invalidate = useCallback(() => {
    generation.current++
    for (const task of [...pending.current.values()]) {
      task.controller?.abort()
      task.settle()
    }
    pending.current.clear()
  }, [])
  const cancel = useCallback(() => {
    invalidate()
    setPanelsState(prev => prev.map(p => p.status === 'streaming' ? { ...p, status: 'aborted' } : p))
  }, [invalidate])
  const setPanels = useCallback((next: PanelConfig[]) => {
    if (next.length < 2 || next.length > 4 || new Set(next.map(c => c.id)).size !== next.length) return
    invalidate()
    configs.current = next
    setPanelsState(prev => next.map(c => {
      const old = prev.find(p => p.id === c.id)
      return old && old.config.provider === c.provider && old.config.modelId === c.modelId
        ? { ...old, config: c, status: old.status === 'streaming' ? 'aborted' : old.status }
        : initialState(c)
    }))
  }, [invalidate])

  useEffect(() => {
    // Session manager changes epoch even when returning to the same account.
    // Clear displayed results too, not only network callbacks.
    const timer = setInterval(() => {
      if (owner.current.id !== getActiveUserId() || owner.current.epoch !== getActiveSessionEpoch()) {
        invalidate()
        owner.current = { id: getActiveUserId(), epoch: getActiveSessionEpoch() }
        setPanelsState(configs.current.map(initialState))
      }
    }, 250)
    return () => { clearInterval(timer); invalidate() }
  }, [invalidate])

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return
    invalidate()
    const run = generation.current
    const userId = getActiveUserId(), epoch = getActiveSessionEpoch()
    owner.current = { id: userId, epoch }
    const current = () => run === generation.current && userId === getActiveUserId() && epoch === getActiveSessionEpoch()
    const inputTokens = estimateTokens(prompt), start = performance.now()
    const selected = configs.current
    const distinct = new Set(selected.map(c => `${c.provider}:${findModel(c.provider, c.modelId)?.modelId ?? c.modelId}`)).size
    const globalError = !userId ? 'compare.access.auth' : selected.length < 2 || selected.length > 4 || distinct < 2 ? 'compare.access.twoModels' : null
    setPanelsState(selected.map(initialState))
    const finishWork = beginConversationWork('comparison-panels')
    try { await Promise.allSettled(selected.map(config => new Promise<void>(resolve => {
      let active = true, accumulated = '', firstToken: number | null = null
      let attribution: ModelUsedEvent | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const task: Pending = { settle: () => {
        if (!active) return
        active = false
        clearTimeout(timer)
        if (pending.current.get(config.id) === task) pending.current.delete(config.id)
        resolve()
      } }
      const valid = () => active && current()
      const assertRequestCurrent = () => {
        if (!valid()) throw new DOMException('Comparison cancelled', 'AbortError')
      }
      const update = (patch: Partial<PanelState>) => {
        if (!valid()) return
        setPanelsState(prev => current() ? prev.map(p => p.id === config.id ? { ...p, ...patch } : p) : prev)
      }
      const metrics = (): PanelMetrics => {
        const costKey = attribution?.source && attribution.source !== 'requested'
          ? findModel(config.provider, attribution.model)?.costKey : undefined
        return { firstTokenMs: firstToken, totalMs: null, inputTokens, outputTokens: estimateTokens(accumulated),
          costEur: costKey ? estimateCostEur(costKey, inputTokens, estimateTokens(accumulated)) : null }
      }
      const finish = (error?: Error) => {
        update({ status: error ? 'error' : 'done', error: error?.message,
          metrics: { ...metrics(), totalMs: Math.round(performance.now() - start) } })
        task.settle()
      }
      pending.current.set(config.id, task)
      const access = globalError ?? options.current.getAccess(config)
      if (access) { finish(new Error(access)); return }
      update({ status: 'streaming', metrics: metrics() })
      timer = setTimeout(() => { finish(new Error('compare.timeout')); task.controller?.abort() }, 120_000)
      try {
        const controller = options.current.factories[config.provider](
          [{ role: 'user', content: prompt }],
          token => {
            if (!valid()) { task.controller?.abort(); task.settle(); return }
            firstToken ??= Math.round(performance.now() - start)
            accumulated += token
            update({ text: accumulated, metrics: metrics() })
          }, () => finish(), finish,
          { model: config.modelId, background: true, comparisonTextOnly: true, assertRequestCurrent,
            expectedUserId: userId, expectedSessionEpoch: epoch,
            onModelUsed: (event: ModelUsedEvent) => {
              if (!valid() || !validModelId(event.model) || !['requested', 'proxy', 'provider'].includes(event.source ?? '')) return
              attribution = { ...event, requestedModel: config.modelId }
              update({ attribution, metrics: metrics() })
            } },
        )
        task.controller = controller
        if (!valid()) controller.abort() // synchronous done/error or Stop during factory
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
    }))) } finally { finishWork() }
  }, [invalidate])
  return { panels, setPanels, send, cancel, isStreaming: panels.some(p => p.status === 'streaming') }
}
