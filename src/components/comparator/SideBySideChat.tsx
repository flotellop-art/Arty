/**
 * SideBySideChat — racine du comparateur.
 * Header (retour + titre + ajouter panneau), grille de ProviderPanel responsive,
 * footer avec textarea partagé. Ctrl/Cmd+Entrée = envoyer, Échap = annuler.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMultiProviderChat, type PanelState, type StreamFactories } from '../../services/comparator/useMultiProviderChat'
import { ProviderPanel } from './ProviderPanel'
import { DEFAULT_PANELS, PROVIDER_CATALOG, type PanelConfig } from '../../services/comparator/providerCatalog'
import { getActiveUserId, getActiveSessionEpoch } from '../../services/userSession'

export interface SideBySideChatProps {
  factories: StreamFactories
  onBack: () => void
  initialPanels?: PanelConfig[]
  getAccess: (config: PanelConfig) => string | null
}

const MAX_PANELS = 4
const MIN_PANELS = 2

function gridColsClass(n: number): string {
  if (n <= 2) return 'grid-cols-1 md:grid-cols-2'
  if (n === 3) return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
  return 'grid-cols-1 md:grid-cols-2 2xl:grid-cols-4'
}

export function SideBySideChat({ factories, onBack, getAccess, initialPanels = DEFAULT_PANELS }: SideBySideChatProps) {
  const { t } = useTranslation()
  const { panels, setPanels, send, cancel, isStreaming } = useMultiProviderChat({ factories, initialPanels, getAccess })
  const accessError = panels.map(p => getAccess(p.config)).find(Boolean)
    ?? (new Set(panels.map(p => `${p.config.provider}:${p.config.modelId}`)).size < 2 ? 'compare.access.twoModels' : null)
  const reportedIds = panels.filter(p => p.attribution && p.attribution.source !== 'requested').map(p => p.attribution!.model)
  const sameReportedModel = reportedIds.length > 1 && new Set(reportedIds).size < reportedIds.length
  const [prompt, setPrompt] = useState('')
  const promptOwner = useRef({ id: getActiveUserId(), epoch: getActiveSessionEpoch() })
  const promptIsCurrent = () => promptOwner.current.id === getActiveUserId() && promptOwner.current.epoch === getActiveSessionEpoch()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const initialized = useRef(false)
  const eligible = PROVIDER_CATALOG.flatMap(p => p.models.map(m => ({ provider: p.id, modelId: m.modelId })))
    .filter(c => !getAccess({ id: 'candidate', ...c }))
  const unused = eligible.filter(c => !panels.some(p => p.config.provider === c.provider && p.config.modelId === c.modelId))

  useEffect(() => {
    if (initialized.current || eligible.length < 2 || panels.some(p => p.status !== 'idle' || p.text)) return
    initialized.current = true
    if (accessError) setPanels(eligible.slice(0, 2).map((c, i) => ({ id: `panel-${i + 1}`, ...c })))
  }, [eligible, panels, accessError, setPanels])

  const handleSubmit = useCallback(() => {
    if (promptOwner.current.id !== getActiveUserId() || promptOwner.current.epoch !== getActiveSessionEpoch()) { setPrompt(''); return }
    if (!prompt.trim() || isStreaming || accessError) return
    void send(prompt)
  }, [prompt, isStreaming, accessError, send])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape' && isStreaming) {
        e.preventDefault()
        cancel()
      }
    },
    [handleSubmit, cancel, isStreaming],
  )

  useEffect(() => {
    textareaRef.current?.focus()
    const timer = setInterval(() => {
      if (!promptIsCurrent()) {
        setPrompt('')
        promptOwner.current = { id: getActiveUserId(), epoch: getActiveSessionEpoch() }
      }
    }, 250)
    return () => clearInterval(timer)
  }, [])

  const addPanel = () => {
    if (panels.length >= MAX_PANELS) return
    const next = unused[0]
    if (!next) return
    const newConfig: PanelConfig = {
      id: `panel-${Date.now()}`,
      ...next,
    }
    setPanels([...panels.map((p) => p.config), newConfig])
  }

  const removePanel = (id: string) => {
    if (panels.length <= MIN_PANELS) return
    setPanels(panels.filter((p) => p.id !== id).map((p) => p.config))
  }

  const updatePanelConfig = (id: string, next: PanelConfig) => {
    setPanels(panels.map((p) => (p.id === id ? next : p.config)))
  }

  return (
    <div
      className="flex flex-col bg-theme-bg text-theme-ink"
      style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-theme-border px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 -ml-1 rounded-lg hover:bg-theme-ink/5 text-theme-ink shrink-0"
            aria-label={t('compare.back')}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M11 4L6 9L11 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="font-display text-base text-theme-ink truncate">
            {t('compare.title')}
            <span className="ml-2 text-xs font-normal text-theme-muted">
              {t('compare.panels', { count: panels.length, max: MAX_PANELS })}
            </span>
          </h1>
        </div>
        <button
          type="button"
          onClick={addPanel}
          disabled={panels.length >= MAX_PANELS || isStreaming || unused.length === 0}
          aria-label={t('compare.addPanelAria')}
          className="rounded-full border border-theme-border bg-theme-surface px-3 py-1 text-xs text-theme-ink hover:bg-theme-ink/[0.03] disabled:opacity-40 shrink-0"
        >
          + {t('compare.addPanel')}
        </button>
      </header>

      {/* Grille de panneaux.
          Mobile (cols-1) : la grille scrolle verticalement, chaque panneau prend
          une hauteur minimale lisible (60vh) — sans ça les panneaux empilés
          dépassaient l'écran et `overflow-hidden` les coupait sans permettre
          de scroller (bug : "impossible de scroller").
          Desktop (md+, cols-2+) : grille à hauteur fixe (overflow-hidden),
          chaque panneau scrolle dans son propre `overflow-y-auto` interne. */}
      <div className={`grid flex-1 gap-3 overflow-y-auto md:overflow-hidden p-3 ${gridColsClass(panels.length)}`}>
        {panels.map((panel: PanelState) => (
          <div key={panel.id} className="min-h-[60vh] md:min-h-0 flex">
            <ProviderPanel
              panel={panel}
              getAccess={getAccess}
              locked={isStreaming}
              onChangeConfig={(next) => updatePanelConfig(panel.id, next)}
              onRemove={panels.length > MIN_PANELS ? () => removePanel(panel.id) : undefined}
            />
          </div>
        ))}
      </div>

      {/* Footer : input partagé */}
      <footer className="border-t border-theme-border p-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} className="mx-auto flex max-w-4xl items-end gap-2">
          <label htmlFor="compare-prompt" className="sr-only">{t('compare.promptLabel')}</label>
          <textarea
            id="compare-prompt"
            ref={textareaRef}
            value={prompt}
            onChange={(e) => {
              if (!promptIsCurrent()) { setPrompt(''); promptOwner.current = { id: getActiveUserId(), epoch: getActiveSessionEpoch() }; return }
              setPrompt(e.target.value)
            }}
            onKeyDown={onKeyDown}
            placeholder={t('compare.promptPlaceholder')}
            rows={2}
            className="flex-1 resize-y rounded-lg border border-theme-border bg-theme-surface px-3 py-2 text-sm text-theme-ink placeholder:text-theme-muted/60 focus:outline-none focus:border-theme-accent"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none self-stretch"
              aria-label={t('compare.stopAria')}
            >
              {t('compare.stop')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!prompt.trim() || !!accessError}
              className="rounded-lg bg-theme-accent px-4 py-2 text-sm font-medium text-theme-bg hover:opacity-90 focus:outline-none disabled:opacity-40 self-stretch"
              aria-label={t('compare.sendAria')}
            >
              {t('compare.send')}
            </button>
          )}
        </form>
        <p className="mx-auto mt-1 max-w-4xl text-[11px] text-theme-muted">{t('compare.help')}</p>
        <p className="mx-auto mt-1 max-w-4xl text-[11px] text-theme-muted">{t('compare.scope', { count: panels.length })}</p>
        {accessError && <p role="status" className="mx-auto max-w-4xl text-xs text-theme-muted">{t(accessError)}</p>}
        {sameReportedModel && <p role="status" className="mx-auto max-w-4xl text-xs text-theme-muted">{t('compare.sameReportedModel')}</p>}
      </footer>
    </div>
  )
}
