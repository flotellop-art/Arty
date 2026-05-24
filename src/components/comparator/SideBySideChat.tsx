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

export interface SideBySideChatProps {
  factories: StreamFactories
  onBack: () => void
  initialPanels?: PanelConfig[]
}

const MAX_PANELS = 4
const MIN_PANELS = 2

function gridColsClass(n: number): string {
  if (n <= 2) return 'grid-cols-1 md:grid-cols-2'
  if (n === 3) return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
  return 'grid-cols-1 md:grid-cols-2 2xl:grid-cols-4'
}

export function SideBySideChat({ factories, onBack, initialPanels = DEFAULT_PANELS }: SideBySideChatProps) {
  const { t } = useTranslation()
  const { panels, setPanels, send, cancel, isStreaming } = useMultiProviderChat({ factories, initialPanels })
  const [prompt, setPrompt] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const handleSubmit = useCallback(() => {
    if (!prompt.trim() || isStreaming) return
    void send(prompt)
  }, [prompt, isStreaming, send])

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
  }, [])

  const addPanel = () => {
    if (panels.length >= MAX_PANELS) return
    const usedProviders = new Set(panels.map((p) => p.config.provider))
    const nextProvider = PROVIDER_CATALOG.find((p) => !usedProviders.has(p.id)) ?? PROVIDER_CATALOG[0]!
    const newConfig: PanelConfig = {
      id: `panel-${Date.now()}`,
      provider: nextProvider.id,
      modelId: nextProvider.models[0]!.modelId,
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
    <main
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
          disabled={panels.length >= MAX_PANELS || isStreaming}
          aria-label={t('compare.addPanelAria')}
          className="rounded-full border border-theme-border bg-theme-surface px-3 py-1 text-xs text-theme-ink hover:bg-theme-ink/[0.03] disabled:opacity-40 shrink-0"
        >
          + {t('compare.addPanel')}
        </button>
      </header>

      {/* Grille de panneaux */}
      <div className={`grid flex-1 gap-3 overflow-hidden p-3 ${gridColsClass(panels.length)}`}>
        {panels.map((panel: PanelState) => (
          <ProviderPanel
            key={panel.id}
            panel={panel}
            onChangeConfig={(next) => updatePanelConfig(panel.id, next)}
            onRemove={panels.length > MIN_PANELS ? () => removePanel(panel.id) : undefined}
          />
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
            onChange={(e) => setPrompt(e.target.value)}
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
              disabled={!prompt.trim()}
              className="rounded-lg bg-theme-accent px-4 py-2 text-sm font-medium text-theme-bg hover:opacity-90 focus:outline-none disabled:opacity-40 self-stretch"
              aria-label={t('compare.sendAria')}
            >
              {t('compare.send')}
            </button>
          )}
        </form>
        <p className="mx-auto mt-1 max-w-4xl text-[11px] text-theme-muted">{t('compare.help')}</p>
      </footer>
    </main>
  )
}
