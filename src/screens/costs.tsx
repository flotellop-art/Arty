/**
 * CostsScreen — dashboard d'usage IA.
 *
 * Lit les stats stockées par costTracker (clé `cost_history` scopée par user)
 * et affiche : résumé du mois, graphique 7 jours, répartition par modèle,
 * configuration de l'alerte budget, export CSV.
 */

import { useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  buildCSV,
  formatCost,
  getAlertConfig,
  getCurrentMonthKey,
  getDailyCost,
  getLastNDays,
  getMonthStats,
  getPreviousMonthKey,
  setAlertConfig,
  type AlertConfig,
} from '../services/costTracker'
import { MODEL_OPTIONS } from '../services/modelSelector'

interface CostsScreenProps {
  onBack: () => void
}

// Code couleur par palier de dépense mensuelle.
function tierColor(eur: number): 'green' | 'yellow' | 'red' {
  if (eur < 5) return 'green'
  if (eur < 20) return 'yellow'
  return 'red'
}

const TIER_HEX: Record<'green' | 'yellow' | 'red', string> = {
  green: '#16a34a',
  yellow: '#eab308',
  red: '#dc2626',
}

// Mappe l'ID modèle (entrée MODEL_COSTS) à un provider pour l'icône.
function providerOf(modelId: string): { label: string; flag: string; provider: string } {
  if (modelId.startsWith('claude')) return matchOption('claude', 'Claude')
  if (modelId.startsWith('gpt')) return matchOption('openai', 'OpenAI')
  if (modelId.startsWith('gemini')) return matchOption('gemini', 'Gemini')
  if (modelId.startsWith('mistral')) return matchOption('mistral', 'Mistral')
  return { label: 'Autre', flag: '🤖', provider: 'other' }
}

function matchOption(id: string, fallback: string) {
  const opt = MODEL_OPTIONS.find((o) => o.id === id)
  return { label: opt?.label || fallback, flag: opt?.flag || '🤖', provider: id }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function shortDay(day: string): string {
  // "2026-04-25" → "25/04"
  const parts = day.split('-')
  const d = parts[2]
  const m = parts[1]
  return d && m ? `${d}/${m}` : day
}

export function CostsScreen({ onBack }: CostsScreenProps) {
  const monthKey = getCurrentMonthKey()

  // Refresh à chaud : recordUsage() dispatche `cost-updated` à la fin de
  // chaque stream IA. On bump un tick pour forcer les useMemo à recomputer.
  // Sans ça, les chiffres restent figés à l'ouverture du dashboard.
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    const handler = () => setRefreshTick((n) => n + 1)
    window.addEventListener('cost-updated', handler)
    return () => window.removeEventListener('cost-updated', handler)
  }, [])

  const stats = useMemo(() => getMonthStats(monthKey), [monthKey, refreshTick])
  const prevStats = useMemo(
    () => getMonthStats(getPreviousMonthKey(monthKey)),
    [monthKey, refreshTick],
  )
  const last7 = useMemo(() => getLastNDays(7), [refreshTick])
  const dailyCosts = useMemo(
    () => last7.map((day) => ({ day, cost: getDailyCost(day) })),
    [last7, refreshTick],
  )

  const [alert, setAlert] = useState<AlertConfig>(() => getAlertConfig())

  const total = stats.total_eur
  const tier = tierColor(total)
  const isEmpty = total === 0 && Object.keys(stats.by_model).length === 0

  const monthDelta = computeDelta(total, prevStats.total_eur)
  const maxDailyCost = Math.max(...dailyCosts.map((d) => d.cost), 0.001)

  const sortedModels = useMemo(() => {
    return Object.entries(stats.by_model)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.cost_eur - a.cost_eur)
  }, [stats])

  const updateAlert = (next: AlertConfig) => {
    setAlert(next)
    setAlertConfig(next)
  }

  const handleExport = async () => {
    const csv = buildCSV()
    const filename = `arty-costs-${monthKey}.csv`

    if (Capacitor.isNativePlatform()) {
      try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
        const { Share } = await import('@capacitor/share')
        await Filesystem.writeFile({
          path: filename,
          data: csv,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        })
        const uriRes = await Filesystem.getUri({
          path: filename,
          directory: Directory.Cache,
        })
        await Share.share({
          title: 'Export coûts Arty',
          text: `Coûts Arty — ${monthKey}`,
          url: uriRes.uri,
          dialogTitle: 'Partager le CSV',
        })
        return
      } catch {
        // Fallback below if Share/Filesystem indisponibles
      }
    }

    // Web fallback : link download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="bg-theme-bg text-theme-ink overflow-y-auto"
      style={{ minHeight: 'var(--viewport-h, 100dvh)' }}
    >
      <header
        className="sticky top-0 z-10 bg-theme-bg flex items-center gap-3 px-5 py-4 border-b border-theme-border"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 1rem))' }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="p-2 -ml-2 rounded hover:bg-theme-ink/5 text-theme-ink"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M12 4L6 10L12 16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
          Mes coûts
        </span>
      </header>

      <div className="max-w-3xl mx-auto px-5 pt-8 pb-12 space-y-8">
        <div>
          <h1 className="font-display font-medium text-[32px] sm:text-[38px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            Tes <span className="italic text-theme-accent">coûts.</span>
          </h1>
          <p className="font-display italic text-theme-muted text-base mt-2">
            Suivi local de l'usage IA, basé sur les tokens réels.
          </p>
        </div>

        {isEmpty ? (
          <EmptyState />
        ) : (
          <>
            <SummarySection
              total={total}
              tier={tier}
              monthDelta={monthDelta}
              alert={alert}
            />

            <DailyChart days={dailyCosts} max={maxDailyCost} tier={tier} />

            <ModelBreakdown models={sortedModels} />
          </>
        )}

        <AlertSection alert={alert} onChange={updateAlert} />

        <ExportSection onExport={handleExport} disabled={isEmpty} />

        <p className="font-display italic text-[11px] text-theme-muted text-center pt-4">
          Données stockées localement, jamais envoyées à un serveur.
          Estimation basée sur les tokens réels — précision ~3% vs facture officielle.
        </p>
      </div>
    </div>
  )
}

// ─── Section 1 — Résumé ──────────────────────────────────────────────────────

interface SummarySectionProps {
  total: number
  tier: 'green' | 'yellow' | 'red'
  monthDelta: { pct: number; up: boolean } | null
  alert: AlertConfig
}

function SummarySection({ total, tier, monthDelta, alert }: SummarySectionProps) {
  const color = TIER_HEX[tier]
  const pctOfBudget =
    alert.enabled && alert.amount_eur > 0
      ? Math.min(100, (total / alert.amount_eur) * 100)
      : 0

  return (
    <section className="rounded-sm border border-theme-border bg-theme-surface p-6">
      <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
        Ce mois-ci
      </p>
      <div className="mt-3 flex items-baseline gap-3 flex-wrap">
        <span
          className="font-display font-medium text-[44px] sm:text-[52px] leading-none -tracking-[0.02em]"
          style={{ color }}
        >
          {formatCost(total)}
        </span>
        {monthDelta && (
          <span
            className={`font-display italic text-sm ${
              monthDelta.up ? 'text-red-500' : 'text-emerald-600'
            }`}
            aria-label={
              monthDelta.up ? 'En hausse vs mois précédent' : 'En baisse vs mois précédent'
            }
          >
            {monthDelta.up ? '▲' : '▼'} {monthDelta.pct}%
          </span>
        )}
      </div>
      <p className="font-display italic text-xs text-theme-muted mt-2">
        vs mois précédent
      </p>

      {alert.enabled && alert.amount_eur > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between font-sans text-[11px] text-theme-muted">
            <span>Budget {formatCost(alert.amount_eur)}</span>
            <span>{Math.round(pctOfBudget)}%</span>
          </div>
          <div className="mt-1.5 h-2 bg-theme-ink/10 rounded-sm overflow-hidden">
            <div
              className="h-full transition-all"
              style={{
                width: `${pctOfBudget}%`,
                backgroundColor: color,
              }}
            />
          </div>
        </div>
      )}
    </section>
  )
}

function computeDelta(current: number, previous: number): { pct: number; up: boolean } | null {
  if (previous <= 0) return null
  const diff = current - previous
  const pct = Math.round((Math.abs(diff) / previous) * 100)
  return { pct, up: diff >= 0 }
}

// ─── Section 2 — Graphique 7 derniers jours ──────────────────────────────────

interface DailyChartProps {
  days: Array<{ day: string; cost: number }>
  max: number
  tier: 'green' | 'yellow' | 'red'
}

function DailyChart({ days, max, tier }: DailyChartProps) {
  const color = TIER_HEX[tier]
  return (
    <section>
      <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
        7 derniers jours
      </p>
      <div className="mt-4 flex items-end gap-2 h-40">
        {days.map(({ day, cost }) => {
          const heightPct = max > 0 ? Math.max(2, (cost / max) * 100) : 2
          return (
            <div key={day} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-sm transition-all"
                  style={{
                    height: `${heightPct}%`,
                    backgroundColor: cost > 0 ? color : 'rgb(var(--theme-ink) / 0.1)',
                  }}
                  aria-label={`${shortDay(day)} — ${formatCost(cost)}`}
                />
              </div>
              <span className="font-mono text-[10px] text-theme-muted truncate w-full text-center">
                {shortDay(day)}
              </span>
              <span className="font-mono text-[10px] text-theme-ink truncate w-full text-center">
                {cost > 0 ? formatCost(cost) : '—'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Section 3 — Répartition par modèle ──────────────────────────────────────

interface ModelBreakdownProps {
  models: Array<{ id: string; input_tokens: number; output_tokens: number; cost_eur: number }>
}

function ModelBreakdown({ models }: ModelBreakdownProps) {
  if (models.length === 0) return null
  return (
    <section>
      <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
        Par modèle
      </p>
      <ul className="mt-4 space-y-2">
        {models.map((m) => {
          const provider = providerOf(m.id)
          const total = m.input_tokens + m.output_tokens
          return (
            <li
              key={m.id}
              className="flex items-center gap-3 px-4 py-3 rounded-sm border border-theme-border bg-theme-surface"
            >
              <span className="text-xl shrink-0" aria-hidden>
                {provider.flag}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm text-theme-ink truncate">{m.id}</p>
                <p className="font-mono text-[11px] text-theme-muted">
                  {formatTokens(total)} tokens · {provider.label}
                </p>
              </div>
              <span className="font-display text-sm text-theme-ink shrink-0">
                {formatCost(m.cost_eur)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─── Section 4 — Alerte de budget ────────────────────────────────────────────

interface AlertSectionProps {
  alert: AlertConfig
  onChange: (next: AlertConfig) => void
}

const SUGGESTED_AMOUNTS = [5, 10, 20, 50]

function AlertSection({ alert, onChange }: AlertSectionProps) {
  const [draft, setDraft] = useState<string>(String(alert.amount_eur))

  const commitAmount = (value: number) => {
    const safe = Math.max(0, Math.round(value * 100) / 100)
    setDraft(String(safe))
    onChange({ ...alert, amount_eur: safe, last_warned_month: undefined })
  }

  return (
    <section className="rounded-sm border border-theme-border bg-theme-surface p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-base text-theme-ink">🔔 M'alerter si je dépasse…</p>
          <p className="font-display italic text-xs text-theme-muted mt-0.5">
            Bannière au prochain lancement quand le mois courant dépasse le seuil.
          </p>
        </div>
        <button
          onClick={() =>
            onChange({ ...alert, enabled: !alert.enabled, last_warned_month: undefined })
          }
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
            alert.enabled ? 'bg-theme-accent' : 'bg-theme-ink/20'
          }`}
          aria-pressed={alert.enabled}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-theme-bg transition-transform ${
              alert.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {alert.enabled && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitAmount(Number(draft) || 0)}
              className="flex-1 bg-transparent border border-theme-border rounded-sm px-3 py-2 font-mono text-sm text-theme-ink focus:outline-none focus:border-theme-accent transition-colors"
              aria-label="Seuil d'alerte en euros"
            />
            <span className="font-display text-sm text-theme-muted">€ / mois</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {SUGGESTED_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => commitAmount(amt)}
                className={`px-3 py-1 rounded-pill border text-xs font-display transition-colors ${
                  Math.abs(alert.amount_eur - amt) < 0.01
                    ? 'border-theme-accent text-theme-accent'
                    : 'border-theme-border text-theme-muted hover:text-theme-ink'
                }`}
              >
                {amt}€
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Section 5 — Export CSV ──────────────────────────────────────────────────

function ExportSection({ onExport, disabled }: { onExport: () => void; disabled: boolean }) {
  return (
    <section>
      <button
        onClick={onExport}
        disabled={disabled}
        className="w-full py-3 font-display italic text-sm font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Exporter CSV
      </button>
      <p className="font-display italic text-[11px] text-theme-muted text-center mt-2">
        Colonnes : date, modele, tokens_input, tokens_output, cout_eur
      </p>
    </section>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-sm border border-theme-border bg-theme-surface p-8 text-center">
      <p className="font-display italic text-base text-theme-muted">
        Commence à chatter pour voir tes coûts ici 💬
      </p>
    </div>
  )
}
