/**
 * useMultiProviderChat — orchestre N appels parallèles aux clients IA existants
 * et expose un état par panneau (streaming, métriques, erreurs isolées).
 *
 * - Un AbortController par panneau (les clients renvoient le leur).
 * - `Promise.allSettled` : un provider qui plante ne fait jamais échouer les autres.
 * - Métriques estimées client-side (latence, tokens, coût indicatif).
 *
 * Le serveur reste la source de vérité pour la facturation réelle.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findModel, type PanelConfig, type ProviderId } from './providerCatalog'
import { estimateTokens, estimateCostEur } from './tokenEstimator'

/** Signature uniforme attendue par le comparateur (cf. ComparatorScreen pour le wiring réel). */
export type StreamFactory = (
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (e: Error) => void,
  options?: Record<string, unknown>,
  apiKeyOverride?: string,
) => AbortController

export interface StreamFactories {
  anthropic: StreamFactory
  gemini: StreamFactory
  mistral: StreamFactory
  openai: StreamFactory
}

export interface PanelMetrics {
  firstTokenMs: number | null
  totalMs: number | null
  inputTokens: number
  outputTokens: number
  costEur: number
}

export interface PanelState {
  id: string
  config: PanelConfig
  text: string
  status: 'idle' | 'streaming' | 'done' | 'error' | 'aborted'
  error?: string
  metrics: PanelMetrics
}

function emptyMetrics(): PanelMetrics {
  return { firstTokenMs: null, totalMs: null, inputTokens: 0, outputTokens: 0, costEur: 0 }
}

function initialState(config: PanelConfig): PanelState {
  return { id: config.id, config, text: '', status: 'idle', metrics: emptyMetrics() }
}

function dispatchStream(
  factories: StreamFactories,
  provider: ProviderId,
  modelId: string,
  messages: Array<{ role: string; content: string }>,
  onToken: (text: string) => void,
  onDone: () => void,
  onError: (e: Error) => void,
): AbortController {
  // F-4 (audit visibilité modèle) — background : les N streams du comparateur
  // ne doivent pas écraser le badge modèle des conversations. Le vecteur réel :
  // des streams ORPHELINS qui continuent après la navigation retour (pas de
  // cancel au unmount) et dispatchent pendant qu'une conversation est affichée.
  const options = { model: modelId, background: true }
  switch (provider) {
    case 'anthropic':
      return factories.anthropic(messages, onToken, onDone, onError, options)
    case 'gemini':
      return factories.gemini(messages, onToken, onDone, onError, options)
    case 'mistral':
      return factories.mistral(messages, onToken, onDone, onError, options)
    case 'openai':
      return factories.openai(messages, onToken, onDone, onError, options)
  }
}

export interface UseMultiProviderChatOptions {
  factories: StreamFactories
  initialPanels?: PanelConfig[]
}

export function useMultiProviderChat(opts: UseMultiProviderChatOptions) {
  const [panels, setPanelsState] = useState<PanelState[]>(
    () => (opts.initialPanels ?? []).map(initialState),
  )
  const controllersRef = useRef<Map<string, AbortController>>(new Map())

  const setPanels = useCallback((configs: PanelConfig[]) => {
    setPanelsState((prev) => configs.map((c) => prev.find((p) => p.id === c.id) ?? initialState(c)))
  }, [])

  const isStreaming = useMemo(() => panels.some((p) => p.status === 'streaming'), [panels])

  const updatePanel = useCallback((id: string, patch: Partial<PanelState>) => {
    setPanelsState((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, ...patch, metrics: { ...p.metrics, ...(patch.metrics ?? {}) } } : p,
      ),
    )
  }, [])

  const send = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) return
      const inputTokens = estimateTokens(prompt)
      const startedAt = performance.now()

      const tasks = panels.map(
        (panel) =>
          new Promise<void>((resolve) => {
            updatePanel(panel.id, {
              text: '',
              status: 'streaming',
              error: undefined,
              metrics: { firstTokenMs: null, totalMs: null, inputTokens, outputTokens: 0, costEur: 0 },
            })

            let firstTokenAt: number | null = null
            let accumulated = ''
            const model = findModel(panel.config.provider, panel.config.modelId)
            const costKey = model?.costKey ?? panel.config.modelId

            const onToken = (token: string) => {
              if (firstTokenAt === null) {
                firstTokenAt = performance.now()
                updatePanel(panel.id, {
                  metrics: { firstTokenMs: Math.round(firstTokenAt - startedAt) } as PanelMetrics,
                })
              }
              accumulated += token
              const outputTokens = estimateTokens(accumulated)
              updatePanel(panel.id, {
                text: accumulated,
                metrics: {
                  outputTokens,
                  costEur: estimateCostEur(costKey, inputTokens, outputTokens),
                } as PanelMetrics,
              })
            }

            const onDone = () => {
              updatePanel(panel.id, {
                status: 'done',
                metrics: { totalMs: Math.round(performance.now() - startedAt) } as PanelMetrics,
              })
              controllersRef.current.delete(panel.id)
              resolve()
            }

            const onError = (e: Error) => {
              updatePanel(panel.id, {
                status: 'error',
                error: e.message || 'error',
                metrics: { totalMs: Math.round(performance.now() - startedAt) } as PanelMetrics,
              })
              controllersRef.current.delete(panel.id)
              resolve() // resolve, pas reject -> isolation par panneau
            }

            try {
              const controller = dispatchStream(
                opts.factories,
                panel.config.provider,
                panel.config.modelId,
                [{ role: 'user', content: prompt }],
                onToken,
                onDone,
                onError,
              )
              controllersRef.current.set(panel.id, controller)
            } catch (e) {
              onError(e instanceof Error ? e : new Error(String(e)))
            }
          }),
      )

      await Promise.allSettled(tasks)
    },
    [panels, opts.factories, updatePanel],
  )

  const cancel = useCallback(() => {
    controllersRef.current.forEach((ctrl, id) => {
      try {
        ctrl.abort()
      } catch {
        /* noop */
      }
      setPanelsState((prev) =>
        prev.map((p) => (p.id === id && p.status === 'streaming' ? { ...p, status: 'aborted' } : p)),
      )
    })
    controllersRef.current.clear()
  }, [])

  // F-4 (fix connexe) — abort des streams au démontage. Le bouton retour du
  // comparateur n'appelait jamais cancel() : les N streams continuaient en
  // ORPHELINS après la navigation (tokens facturés pour un écran fermé, et
  // dispatchs 'arty-model-used' tardifs par-dessus la conversation affichée).
  useEffect(() => {
    const controllers = controllersRef.current
    return () => {
      controllers.forEach((ctrl) => {
        try { ctrl.abort() } catch { /* noop */ }
      })
      controllers.clear()
    }
  }, [])

  return { panels, setPanels, send, cancel, isStreaming }
}
