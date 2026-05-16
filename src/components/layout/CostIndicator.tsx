import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchMonthlyQuotaStatus,
  type MonthlyModelUsage,
  type MonthlyQuotaStatus,
} from '../../services/quotaStatus'

// Refresh périodique du badge. MED (audit étape 6) — 60s était trop fréquent :
// l'event 'cost-updated' (BUG 54) fire à chaque recordUsage local, ce qui
// couvre 99% des cas. L'interval ne sert plus qu'au sync multi-device
// (autre onglet/tel du même user consomme), 5 min suffit largement.
const REFRESH_MS = 5 * 60_000

export function CostIndicator() {
  const { t } = useTranslation()
  const [data, setData] = useState<MonthlyQuotaStatus | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const refresh = useCallback(async () => {
    const status = await fetchMonthlyQuotaStatus()
    if (status) setData(status)
  }, [])

  useEffect(() => {
    refresh()
    const interval = window.setInterval(refresh, REFRESH_MS)
    const onCostEvent = () => { refresh() }
    window.addEventListener('cost-updated', onCostEvent)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('cost-updated', onCostEvent)
    }
  }, [refresh])

  // Pas de données → utilisateur non whitelisté (BYOK pur), on cache le badge.
  if (!data) return null

  const cost = data.totalCostUsd
  const color = cost > 0.5 ? 'text-red-500' : cost > 0.1 ? 'text-yellow-600' : 'text-green-600'

  return (
    <>
      <button
        onClick={() => setShowDetails(true)}
        className={`px-2 py-1 text-[11px] font-mono font-semibold rounded-md hover:bg-theme-ink/5 transition-colors ${color}`}
        title={t('costs.badgeTitle')}
        aria-label={t('costs.badgeAria')}
      >
        ~${cost.toFixed(2)}
      </button>
      {showDetails && <CostModal data={data} onRefresh={refresh} onClose={() => setShowDetails(false)} />}
    </>
  )
}

interface CostModalProps {
  data: MonthlyQuotaStatus
  onRefresh: () => Promise<void>
  onClose: () => void
}

function CostModal({ data, onRefresh, onClose }: CostModalProps) {
  const { t } = useTranslation()
  // Refresh à l'ouverture pour avoir le chiffre le plus frais possible.
  useEffect(() => { onRefresh() }, [onRefresh])

  const byModel: MonthlyModelUsage[] = data.byModel

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-theme-ink/50" onClick={onClose}>
      <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="font-display text-lg text-theme-ink">💰 {t('costs.modalTitle')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-theme-ink/5 text-theme-muted" aria-label={t('common.close')}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <div className="mb-4 pb-4 border-b border-theme-border">
            <p className="text-[10px] uppercase tracking-wider text-theme-muted">{t('costs.totalThisMonth', { month: data.month })}</p>
            <p className="text-3xl font-display font-medium text-theme-accent mt-1">${data.totalCostUsd.toFixed(4)}</p>
            <p className="text-xs text-theme-muted mt-1">
              {t('costs.tokensLine', { input: data.totalInputTokens.toLocaleString(), output: data.totalOutputTokens.toLocaleString(), calls: data.totalCalls })}
            </p>
          </div>

          <p className="text-[10px] uppercase tracking-wider text-theme-muted mb-2">{t('costs.byModel')}</p>
          {byModel.length === 0 ? (
            <p className="text-sm text-theme-muted text-center py-4">{t('costs.noUsage')}</p>
          ) : (
            <ul className="space-y-2">
              {byModel.map((m) => (
                <li key={m.model} className="flex items-center justify-between text-sm">
                  <span className="text-theme-ink">{m.model}</span>
                  <div className="text-right">
                    <p className="font-mono font-semibold">${m.costUsd.toFixed(4)}</p>
                    <p className="text-[10px] text-theme-muted">
                      {t('costs.modelLine', { input: m.inputTokens.toLocaleString(), output: m.outputTokens.toLocaleString(), count: m.count })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
