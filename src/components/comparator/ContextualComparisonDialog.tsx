import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TEXT_MODELS } from '../../services/modelCatalog'
import type { useContextualComparisons } from '../../hooks/useContextualComparisons'

export function ContextualComparisonDialog({ controller, onStarted }: {
  controller: ReturnType<typeof useContextualComparisons>; onStarted(id: string): void
}) {
  const { t } = useTranslation(), selection = controller.selection!
  const [panels, setPanels] = useState(selection.panels)
  useEffect(() => { setPanels(selection.panels) }, [selection.panels])
  const root = useRef<HTMLDivElement>(null), cancel = useRef(controller.cancel); cancel.current = controller.cancel
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.focus()
    const key = (e: KeyboardEvent) => {
      // The document selection/confirmation modal owns focus while above us.
      if (document.querySelector('[aria-labelledby="project-review-title"]')) return
      if (!root.current?.contains(document.activeElement)) root.current?.focus()
      if (e.key === 'Escape') { e.preventDefault(); cancel.current() }
      if (e.key === 'Tab') {
        const nodes = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)') ?? [])]
        if (e.shiftKey && (document.activeElement === nodes[0] || document.activeElement === root.current)) { e.preventDefault(); nodes.at(-1)?.focus() }
        else if (!e.shiftKey && (document.activeElement === nodes.at(-1) || document.activeElement === root.current)) { e.preventDefault(); nodes[0]?.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); previous?.focus() }
  }, [])
  const errors = panels.map(p => controller.getAccess(p)).filter(Boolean)
  const same = panels.length !== 2 || panels[0]?.modelId === panels[1]?.modelId
  return <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-3">
    <div ref={root} role="dialog" aria-modal="true" aria-labelledby="context-compare-title" tabIndex={-1} className="bg-theme-bg text-theme-ink border border-theme-border rounded-xl p-5 w-full max-w-xl max-h-[90dvh] overflow-y-auto space-y-4">
      <h2 id="context-compare-title" className="text-xl">{t('compare.context.title')}</h2>
      <p className="whitespace-pre-wrap break-words max-h-36 overflow-y-auto">{selection.question}</p>
      <p className="text-sm">{t('compare.context.explanation')}</p>
      {panels.map((panel, index) => <label className="block" key={panel.id}>{t('compare.model')} {index + 1}
        <select className="block min-h-11 w-full bg-theme-bg border p-2" disabled={selection.busy} value={panel.modelId} onChange={e => setPanels(old => old.map((p, i) => i === index ? { ...p, modelId: e.target.value } : p))}>
          {TEXT_MODELS.filter(m => m.provider === selection.provider).map(m => <option key={m.modelId} value={m.modelId} disabled={!!controller.getAccess({ ...panel, modelId: m.modelId })}>{m.label}</option>)}
        </select>
        <span className="text-xs text-theme-muted">{t(controller.getQuota(panel).key, controller.getQuota(panel).values)}</span>
      </label>)}
      {errors.map((error, index) => <p role="status" key={index}>{t(error!)}</p>)}
      {same && <p role="status">{t('compare.access.twoModels')}</p>}
      <div className="flex gap-3 flex-wrap">
        <button className="min-h-11 border px-3" onClick={controller.cancel}>{t('common.cancel')}</button>
        <button className="min-h-11 border px-3 disabled:opacity-40" disabled={selection.busy || same || errors.length > 0} onClick={() => { void controller.start(panels).then(id => { if (id) onStarted(id) }) }}>{t(selection.busy ? 'common.loading' : 'compare.context.prepare')}</button>
      </div>
    </div>
  </div>
}
