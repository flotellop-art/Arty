import { useCallback, useEffect, useRef, useState } from 'react'
import { captureContextualComparison } from '../services/comparator/contextualPreparation'
import { startContextualComparison } from '../services/comparator/contextualRunner'
import { panelAccess } from '../services/comparator/access'
import { TEXT_MODELS } from '../services/modelCatalog'
import { findModel, type PanelConfig } from '../services/comparator/providerCatalog'
import { usePlanStatus } from './usePlanStatus'
import { getActiveSession } from '../services/userSession'
import { hasPersonalKey } from '../services/providerLock'
import { getTrialRemaining } from '../services/trialClient'
import { beginConversationWork, hasConversationWork } from '../services/conversationWork'
import type { useStreaming } from './useStreaming'
import type { ReviewProjectRequest } from '../services/projects/chatPreparation'
import { ProjectError } from '../services/projects/types'
import { OfficeReadError } from '../services/documents/officeArchive'
import { onLocalDataInvalidated } from '../services/localDataInvalidation'

type Selection = { sourceId: string; provider: 'anthropic' | 'mistral'; question: string; panels: PanelConfig[]; busy: boolean; error?: string }
export function useContextualComparisons(streams: ReturnType<typeof useStreaming>, refresh: () => void, review: ReviewProjectRequest) {
  const [active, setActive] = useState(false)
  const activate = useCallback(() => setActive(true), [])
  const plan = usePlanStatus(active), planRef = useRef(plan); planRef.current = plan
  const streamsRef = useRef(streams); streamsRef.current = streams
  const refreshRef = useRef(refresh); refreshRef.current = refresh
  const reviewRef = useRef(review); reviewRef.current = review
  const [selection, setSelection] = useState<Selection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const pending = useRef<{ actor: ReturnType<typeof captureContextualComparison>; controller: AbortController; finish(): void; busy: boolean } | null>(null)
  const runs = useRef(new Set<ReturnType<typeof startContextualComparison>>())
  const getAccess = useCallback((config: PanelConfig) => panelAccess(config, {
    plan: planRef.current, authenticated: !!getActiveSession() && getActiveSession()?.authMethod !== 'demo',
    personalKey: hasPersonalKey(config.provider), trialRemaining: getTrialRemaining(),
  }), [])
  const getQuota = useCallback((config: PanelConfig): { key: string; values?: Record<string, number> } => {
    if (hasPersonalKey(config.provider)) return { key: 'compare.context.quotaByok' }
    const current = planRef.current, family = findModel(config.provider, config.modelId)?.family
    if (!family || current.loading || current.statusUnavailable || current.authRejected || current.authRequired) return { key: 'compare.context.quotaUnknown' }
    const trial = getTrialRemaining()
    if (current.plan === 'free' && trial !== null && trial > 0) return { key: 'compare.context.quotaTrial', values: { remaining: trial } }
    const monthly = current.monthlyCap?.[family === 'claude-opus' ? 'claude-sonnet' : family]
    if (monthly && Number.isFinite(monthly.remaining) && monthly.remaining >= 0) return {
      key: 'compare.context.quotaMonthly', values: { remaining: monthly.remaining, limit: monthly.limit, pack: current.premiumPackRemaining },
    }
    const daily = current.dailyRemaining?.[family as keyof NonNullable<typeof current.dailyRemaining>]
    return typeof daily === 'number' && Number.isFinite(daily) && daily >= 0
      ? { key: 'compare.context.quotaDaily', values: { remaining: daily } } : { key: 'compare.context.quotaUnknown' }
  }, [])
  const cancel = useCallback(() => {
    const old = pending.current; pending.current = null
    old?.controller.abort(); old?.finish()
    if (alive.current) setSelection(null)
  }, [])
  const open = useCallback((sourceId: string, messageId: string) => {
    activate()
    cancel(); setError(null)
    const controller = new AbortController()
    try {
      const actor = captureContextualComparison({ sourceId, messageId, signal: controller.signal, getAccess,
        isBusy: id => streamsRef.current.hasStream(id) || hasConversationWork(id) })
      pending.current = { actor, controller, finish: beginConversationWork(sourceId), busy: false }
      const eligible = TEXT_MODELS.filter(m => m.provider === actor.provider && !getAccess({ id: '', provider: m.provider, modelId: m.modelId }))
      const candidates = eligible.length >= 2 ? eligible : TEXT_MODELS.filter(m => m.provider === actor.provider)
      setSelection({ sourceId, provider: actor.provider, question: actor.question, busy: false,
        panels: candidates.slice(0, 2).map((m, index) => ({ id: String(index), provider: m.provider, modelId: m.modelId })) })
    } catch (reason) {
      controller.abort()
      setError(reason instanceof ProjectError && reason.code === 'unsupported' ? 'compare.context.unsupported' : 'compare.context.unavailable')
    }
  }, [activate, cancel, getAccess])
  const start = useCallback(async (panels: PanelConfig[]): Promise<string | null> => {
    const task = pending.current
    if (!task || task.busy) return null
    task.busy = true; setSelection(old => old ? { ...old, busy: true } : old)
    try {
      const prepared = await task.actor.prepare(panels, (value, signal) => reviewRef.current(value, signal))
      if (!alive.current || pending.current !== task) return null
      task.actor.assertCurrent()
      const run = startContextualComparison(prepared, streamsRef.current, () => { if (alive.current) refreshRef.current() })
      runs.current.add(run)
      pending.current = null; task.finish(); setSelection(null); refreshRef.current()
      return run.branchIds[0]
    } catch (reason) {
      if (alive.current && pending.current === task) {
        const message = reason instanceof ProjectError ? (reason.code === 'unsupported' ? 'compare.context.unsupported' : `projects.errors.${reason.code}`)
          : reason instanceof OfficeReadError ? 'compare.context.unsupported'
          : reason instanceof Error && reason.message.startsWith('compare.') ? reason.message : 'compare.context.unavailable'
        cancel(); setError(message)
      }
      return null
    }
  }, [cancel])
  useEffect(() => {
    alive.current = true
    const unsubscribe = onLocalDataInvalidated(cancel)
    const timer = setInterval(() => {
      try { pending.current?.actor.assertCurrent() } catch { cancel() }
      // Completed durable results need no retained payload/controller in RAM.
      for (const run of runs.current) if (run.branchIds.every(id => { const p = run.read(id); return !p || (p.saved && !streamsRef.current.hasStream(id)) })) runs.current.delete(run)
    }, 250)
    return () => {
      alive.current = false; clearInterval(timer); unsubscribe(); cancel()
      for (const run of runs.current) run.cancel()
      runs.current.clear()
    }
  }, [cancel])
  return { selection, error, dismissError: () => setError(null), activate, open, cancel, start, getAccess, getQuota,
    readLive: (id: string) => { for (const run of runs.current) { const p = run.read(id); if (p) return p } return null } }
}
