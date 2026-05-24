/**
 * ProviderPanel — un panneau du comparateur.
 * En-tête (sélecteurs provider/modèle), corps (réponse en Markdown sanitisé),
 * pied (métriques : latence, tokens, coût estimé). Isolation des erreurs par panneau.
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownRenderer } from '../shared/MarkdownRenderer'
import { PROVIDER_CATALOG, type PanelConfig, type ProviderId } from '../../services/comparator/providerCatalog'
import type { PanelState } from '../../services/comparator/useMultiProviderChat'

export interface ProviderPanelProps {
  panel: PanelState
  onChangeConfig: (next: PanelConfig) => void
  onRemove?: () => void
}

const STATUS_CLS: Record<PanelState['status'], string> = {
  idle: 'bg-theme-ink/10 text-theme-muted',
  streaming: 'bg-theme-accent/15 text-theme-accent animate-pulse',
  done: 'bg-theme-accent/10 text-theme-ink',
  error: 'bg-red-500/15 text-red-500',
  aborted: 'bg-theme-ink/10 text-theme-muted',
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatEur(eur: number): string {
  if (eur === 0) return '0 €'
  if (eur < 0.0001) return '< 0,0001 €'
  return `${eur.toFixed(4)} €`
}

export const ProviderPanel = memo(function ProviderPanel({ panel, onChangeConfig, onRemove }: ProviderPanelProps) {
  const { t } = useTranslation()
  const { config, text, status, error, metrics } = panel
  const provider = PROVIDER_CATALOG.find((p) => p.id === config.provider)
  const models = provider?.models ?? []

  return (
    <section
      role="region"
      aria-label={`${provider?.label ?? config.provider} — ${config.modelId}`}
      className="flex flex-col rounded-lg border border-theme-border bg-theme-surface overflow-hidden h-full min-h-0"
    >
      {/* Header : sélecteurs */}
      <header className="flex items-center gap-2 border-b border-theme-border bg-theme-bg/40 px-2 py-1.5 text-xs">
        <label className="sr-only" htmlFor={`${config.id}-provider`}>{t('compare.provider')}</label>
        <select
          id={`${config.id}-provider`}
          value={config.provider}
          onChange={(e) => {
            const nextProvider = e.target.value as ProviderId
            const nextModelId =
              PROVIDER_CATALOG.find((p) => p.id === nextProvider)?.models[0]?.modelId ?? config.modelId
            onChangeConfig({ ...config, provider: nextProvider, modelId: nextModelId })
          }}
          disabled={status === 'streaming'}
          className="rounded border border-theme-border bg-theme-surface px-1.5 py-0.5 text-xs text-theme-ink focus:outline-none focus:border-theme-accent disabled:opacity-50"
        >
          {PROVIDER_CATALOG.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`${config.id}-model`}>{t('compare.model')}</label>
        <select
          id={`${config.id}-model`}
          value={config.modelId}
          onChange={(e) => onChangeConfig({ ...config, modelId: e.target.value })}
          disabled={status === 'streaming' || models.length <= 1}
          className="flex-1 min-w-0 rounded border border-theme-border bg-theme-surface px-1.5 py-0.5 text-xs text-theme-ink focus:outline-none focus:border-theme-accent disabled:opacity-50"
        >
          {models.map((m) => (
            <option key={m.modelId} value={m.modelId}>{m.label}</option>
          ))}
        </select>

        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLS[status]}`}>
          {t(`compare.status.${status}`)}
        </span>

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            disabled={status === 'streaming'}
            aria-label={t('compare.removePanelAria', { provider: provider?.label ?? config.provider })}
            className="rounded p-1 text-theme-muted hover:bg-theme-ink/10 hover:text-theme-ink focus:outline-none disabled:opacity-30"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </header>

      {/* Corps : réponse */}
      <div className="flex-1 overflow-y-auto p-3 text-sm min-h-0" aria-live="polite" aria-busy={status === 'streaming'}>
        {status === 'error' && (
          <div role="alert" className="rounded border border-red-500/40 bg-red-500/10 p-2 text-red-500 text-xs">
            <strong>{t('compare.errorPrefix')}</strong> {error}
          </div>
        )}
        {status === 'idle' && !text && (
          <p className="text-theme-muted italic">{t('compare.waiting')}</p>
        )}
        {text && <MarkdownRenderer content={text} />}
      </div>

      {/* Footer : métriques */}
      <footer
        className="grid grid-cols-3 gap-1 border-t border-theme-border bg-theme-bg/40 px-2 py-1.5 text-[11px] text-theme-muted"
        aria-label="metrics"
      >
        <div>
          <div className="text-theme-muted">{t('compare.metricFirstToken')}</div>
          <div className="font-mono text-theme-ink">{formatMs(metrics.firstTokenMs)}</div>
        </div>
        <div>
          <div className="text-theme-muted">{t('compare.metricTotal')}</div>
          <div className="font-mono text-theme-ink">{formatMs(metrics.totalMs)}</div>
        </div>
        <div>
          <div className="text-theme-muted">{t('compare.metricCost')}</div>
          <div className="font-mono text-theme-ink">{formatEur(metrics.costEur)}</div>
        </div>
        <div className="col-span-3 text-[10px] text-theme-muted">
          {t('compare.metricTokens', { in: metrics.inputTokens, out: metrics.outputTokens })}
        </div>
      </footer>
    </section>
  )
})
