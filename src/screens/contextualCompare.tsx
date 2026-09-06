import { useEffect, useReducer, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as storage from '../services/storage'
import type { Conversation } from '../types'
import type { useContextualComparisons } from '../hooks/useContextualComparisons'
import type { PanelState } from '../services/comparator/useMultiProviderChat'
import { ProviderPanel } from '../components/comparator/ProviderPanel'
import { ProjectSources } from '../components/chat/ProjectSources'
import { captureLocalReadScope } from '../services/projects/store'
import { onLocalDataInvalidated } from '../services/localDataInvalidation'
import { getActiveUserId, getActiveSessionEpoch } from '../services/userSession'
import { outputNoticeForMessage } from '../services/workflows/outputRestriction'

/** Read-only boot gate, including the durable fence. A captured scope is
 * terminally revoked, never rebound to new keys behind the same open screen. */
function useComparisonReadScope() {
  const [state, setState] = useState<{ scope?: ReturnType<typeof captureLocalReadScope>; failed?: boolean }>({})
  useEffect(() => {
    let alive = true, failed = false, validating = false, scope: ReturnType<typeof captureLocalReadScope> | undefined
    const owner = getActiveUserId(), epoch = getActiveSessionEpoch()
    const revoke = () => { failed = true; if (alive) setState({ failed: true }) }
    const attempt = () => {
      if (!alive || failed) return
      if (scope) { try { scope.assertCurrent() } catch { revoke() }; return }
      if (validating) return
      try {
        if (!storage.isCacheReady()) return
        const captured = captureLocalReadScope()
        validating = true
        void captured.validateReadOnly().then(() => {
          captured.assertCurrent()
          if (alive && !failed) { scope = captured; setState({ scope }) }
        }).catch(revoke)
      } catch { /* Boot may still be initializing keys; bounded wait below. */ }
    }
    const timer = setInterval(attempt, 100)
    const timeout = setTimeout(() => { if (!scope) revoke() }, 10_000)
    const unsubscribe = onLocalDataInvalidated(() => {
      // An initial key bootstrap may finish after this lazy route mounts.
      // No data has been read yet; only this initial, unchanged identity may
      // become ready. Once a scope is captured, revocation is terminal.
      if (scope || validating || owner !== getActiveUserId() || epoch !== getActiveSessionEpoch()) revoke()
    })
    window.addEventListener('conversations-storage-ready', attempt)
    attempt()
    return () => { alive = false; clearInterval(timer); clearTimeout(timeout); unsubscribe(); window.removeEventListener('conversations-storage-ready', attempt) }
  }, [])
  try { state.scope?.assertCurrent() } catch { return { failed: true } }
  return state
}

export function contextualPeer(branch: Conversation, peer: Conversation | null): Conversation | null {
  const a = branch.comparison, b = peer?.comparison
  return a && b && peer?.id !== branch.id && a.peerId === peer?.id && b.peerId === branch.id &&
    a.version === 1 && b.version === 1 && a.groupId === b.groupId && a.sourceConversationId === b.sourceConversationId &&
    a.sourceMessageId === b.sourceMessageId ? peer : null
}
export function comparisonPanel(branch: Conversation): PanelState | null {
  const c = branch.comparison
  if (!c || c.version !== 1 || !['anthropic', 'mistral'].includes(c.provider) || typeof c.requestedModel !== 'string' || typeof c.responseId !== 'string' ||
      !['pending', 'streaming', 'done', 'error', 'aborted'].includes(c.status)) return null
  const response = branch.messages.find(m => m.id === c.responseId && m.role === 'assistant')
  return { id: branch.id, config: { id: branch.id, provider: c.provider, modelId: c.requestedModel }, text: response?.content ?? '',
    status: c.status === 'pending' || c.status === 'streaming' || (c.status === 'done' && !response) ? 'aborted' : c.status, error: c.error, attribution: c.attribution,
    metrics: c.metrics ?? { firstTokenMs: null, totalMs: null, inputTokens: 0, outputTokens: 0, costEur: null } }
}
export function ContextualCompareScreen({ controller, onChat, onBack, onStop }: {
  controller: ReturnType<typeof useContextualComparisons>; onChat(id: string): void; onBack(): void; onStop(id: string): void
}) {
  const { branchId } = useParams<{ branchId: string }>(), { t, i18n } = useTranslation()
  const readScope = useComparisonReadScope()
  useEffect(() => { controller.activate?.() }, [controller.activate])
  const [, refresh] = useReducer(n => n + 1, 0)
  useEffect(() => {
    window.addEventListener('conversations-storage-ready', refresh)
    return () => { window.removeEventListener('conversations-storage-ready', refresh) }
  }, [])
  let branch: Conversation | null = null, ready = false
  try { ready = !!readScope.scope && storage.isCacheReady(); if (ready && branchId) branch = storage.getConversation(branchId) } catch { /* locked document */ }
  const base = branch && comparisonPanel(branch)
  if (!branch || !base) return <div className="p-5 space-y-4"><button className="min-h-11 border px-3" onClick={onBack}>{t('compare.back')}</button><p role="status">{t(readScope.failed ? 'compare.context.unavailable' : ready ? 'compare.context.missing' : 'compare.context.loading')}</p></div>
  const peer = contextualPeer(branch, storage.getConversation(branch.comparison!.peerId))
  const entries = [branch, ...(peer ? [peer] : [])].map(value => ({ value, live: controller.readLive(value.id) }))
  const reported = entries.map(({ value, live }) => (live ?? comparisonPanel(value))?.attribution).filter(a => a && a.source !== 'requested')
  const sameReported = reported.length === 2 && reported[0]?.model === reported[1]?.model
  const question = branch.messages.find(m => m.id === branch!.comparison!.questionId && m.role === 'user')
  return <div className="h-full overflow-y-auto p-3 sm:p-5 space-y-4">
    <header className="flex flex-wrap gap-3 items-center"><button className="min-h-11 border px-3" onClick={onBack}>{t('compare.back')}</button><h1 className="text-xl">{t('compare.context.title')}</h1></header>
    <p>{t('compare.context.continuation')}</p>
    {question && <details className="border border-theme-border p-3"><summary>{t('compare.context.question')}</summary><p className="whitespace-pre-wrap break-words py-2">{question.content}</p>{question.projectTurn && <ProjectSources turn={question.projectTurn} prepared />}</details>}
    <p className="text-xs text-theme-muted">{t('compare.context.estimates')}</p>
    <div className="flex gap-3 flex-wrap">
      {storage.getConversation(branch.comparison!.sourceConversationId) && <button className="min-h-11 border px-3" onClick={() => onChat(branch!.comparison!.sourceConversationId)}>{t('compare.context.original')}</button>}
      <button className="min-h-11 border px-3" onClick={() => controller.open(branch!.id, branch!.comparison!.questionId)}>{t('compare.context.new')}</button>
    </div>
    {!peer && <p role="status">{t('compare.context.peerMissing')}</p>}
    {sameReported && <p role="status">{t('compare.sameReportedModel')}</p>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {entries.map(({ value, live }) => {
        const panel = live ?? comparisonPanel(value)
        if (!panel) return <p key={value.id}>{t('compare.context.missing')}</p>
        const quota = controller.getQuota?.(panel.config)
        const persistedResponse = value.messages.some(m => m.id === value.comparison!.responseId && m.role === 'assistant')
        const unsaved = !!live && !live.saved && panel.status !== 'streaming'
        const outputNotice = outputNoticeForMessage(value, { id: value.comparison!.responseId, role: 'assistant', content: panel.text,
          interrupted: panel.status !== 'done' }, { locale: i18n.language, streaming: panel.status === 'streaming' })
        return <div key={value.id} className="min-w-0 space-y-2">
          <div className="h-[65dvh] min-h-72"><ProviderPanel panel={panel} outputNotice={outputNotice} onChangeConfig={() => {}} getAccess={() => null} locked /></div>
          {quota && <p className="text-xs text-theme-muted">{t(quota.key, quota.values)}</p>}
          {unsaved && <p role="alert">{t('compare.context.notSaved')}</p>}
          {panel.status === 'streaming' ? <button className="min-h-11 border px-3" onClick={() => onStop(value.id)}>{t('compare.stop')}</button>
            : <button className="min-h-11 border px-3 disabled:opacity-40" disabled={unsaved || !persistedResponse} onClick={() => onChat(value.id)}>{t('compare.context.continue')}</button>}
        </div>
      })}
    </div>
    <p className="text-xs text-theme-muted">{t('compare.context.exportNotice')}</p>
  </div>
}
