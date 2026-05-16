/**
 * TemplatesScreen — Pro feature: pré-remplir un message à partir d'un
 * gabarit métier (devis, mise en demeure, fiche produit, etc.). L'écran
 * affiche les gabarits par catégorie ; au clic l'utilisateur remplit les
 * champs, puis on génère le prompt final et on lance une nouvelle
 * conversation avec ce prompt comme premier message.
 *
 * Plan gating : `'pro'` et `'subscription'` débloquent. Les utilisateurs
 * `'byok'` ou `'unknown'` voient les cartes mais sont redirigés vers
 * l'écran d'upgrade au clic, et une bannière "Feature Pro" s'affiche en
 * haut.
 */

import { memo, useEffect, useMemo, useState } from 'react'
import {
  CATEGORY_LABELS,
  TEMPLATES,
  type Template,
  type TemplateCategory,
  renderTemplatePrompt,
} from '../data/templates'
import type { CurrentPlan } from './upgrade'

interface TemplatesScreenProps {
  onBack: () => void
  onUpgrade: () => void
  onUseTemplate: (prompt: string) => void
  currentPlan: CurrentPlan
}

type FilterValue = 'all' | TemplateCategory

const FILTERS: Array<{ value: FilterValue; label: string; icon?: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'freelance', label: CATEGORY_LABELS.freelance.label, icon: CATEGORY_LABELS.freelance.icon },
  { value: 'admin', label: CATEGORY_LABELS.admin.label, icon: CATEGORY_LABELS.admin.icon },
  { value: 'juridique', label: CATEGORY_LABELS.juridique.label, icon: CATEGORY_LABELS.juridique.icon },
  { value: 'marketing', label: CATEGORY_LABELS.marketing.label, icon: CATEGORY_LABELS.marketing.icon },
  { value: 'finances', label: CATEGORY_LABELS.finances.label, icon: CATEGORY_LABELS.finances.icon },
]

function TemplatesScreenInner({ onBack, onUpgrade, onUseTemplate, currentPlan }: TemplatesScreenProps) {
  const [filter, setFilter] = useState<FilterValue>('all')
  const [selected, setSelected] = useState<Template | null>(null)

  const isPro = currentPlan === 'pro' || currentPlan === 'subscription'

  const visibleTemplates = useMemo(() => {
    if (filter === 'all') return TEMPLATES
    return TEMPLATES.filter((t) => t.category === filter)
  }, [filter])

  const handleCardClick = (template: Template) => {
    if (!isPro) {
      onUpgrade()
      return
    }
    setSelected(template)
  }

  const handleSubmit = (prompt: string) => {
    setSelected(null)
    onUseTemplate(prompt)
  }

  return (
    <div
      className="bg-theme-bg text-theme-ink overflow-y-auto"
      style={{ minHeight: 'var(--viewport-h, 100dvh)' }}
    >
      {/* Header sticky avec retour + kicker */}
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
            <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
          Bibliothèque · Pro
        </span>
      </header>

      <div className="max-w-4xl mx-auto px-5 pt-6 pb-12">
        {/* Hero */}
        <div className="mb-5">
          <h1 className="font-display font-medium text-[32px] sm:text-[38px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            Templates <span className="italic text-theme-accent">métier.</span>
          </h1>
          <p className="font-display italic text-theme-muted text-base mt-2">
            Des gabarits prêts à l'emploi pour démarrer une conversation en 10 secondes.
          </p>
        </div>

        {/* Bannière Pro si non débloqué */}
        {!isPro && (
          <button
            type="button"
            onClick={onUpgrade}
            className="w-full mb-6 rounded-sm border border-theme-accent/60 bg-theme-surface px-4 py-4 text-left flex items-center justify-between gap-4 transition-opacity hover:opacity-90"
          >
            <div>
              <p className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-accent">
                Feature Pro
              </p>
              <p className="font-display text-base text-theme-ink mt-1">
                Débloque <span className="italic">Arty Pro</span> pour utiliser les templates.
              </p>
              <p className="font-display italic text-xs text-theme-muted mt-0.5">
                39 € à vie · 3 appareils · Tous les gabarits inclus.
              </p>
            </div>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-theme-accent flex-shrink-0">
              <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        {/* Chips horizontaux scrollables */}
        <div className="-mx-5 px-5 overflow-x-auto pb-3 mb-5 [&::-webkit-scrollbar]:hidden">
          <div className="flex gap-2 w-max">
            {FILTERS.map((f) => {
              const active = filter === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-pill border text-[12px] font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-theme-ink text-theme-bg border-theme-ink'
                      : 'bg-transparent text-theme-muted border-theme-border hover:text-theme-ink hover:border-theme-ink/40'
                  }`}
                  aria-pressed={active}
                >
                  {f.icon && <span className="text-[13px] leading-none">{f.icon}</span>}
                  <span>{f.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Grille de cards */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          {visibleTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              locked={!isPro}
              onClick={() => handleCardClick(template)}
            />
          ))}
        </div>

        {visibleTemplates.length === 0 && (
          <p className="text-center text-theme-muted text-sm py-12">
            Aucun template dans cette catégorie.
          </p>
        )}
      </div>

      {selected && (
        <TemplateFormModal
          template={selected}
          onCancel={() => setSelected(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: Template
  locked: boolean
  onClick: () => void
}

function TemplateCard({ template, locked, onClick }: TemplateCardProps) {
  const cat = CATEGORY_LABELS[template.category]
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-col items-start text-left rounded-sm bg-theme-surface border border-theme-border p-4 sm:p-5 hover:border-theme-ink/40 transition-colors h-full"
    >
      <div className="flex items-center justify-between w-full mb-2">
        <span className="text-[22px] leading-none">{template.icon}</span>
        {locked && (
          <span aria-label="Pro" title="Réservé aux comptes Pro" className="text-theme-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="9" rx="1.5" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </svg>
          </span>
        )}
      </div>
      <h3 className="font-display text-[15px] sm:text-base leading-snug text-theme-ink font-medium">
        {template.title}
      </h3>
      <p className="mt-1.5 font-sans text-[12px] text-theme-muted leading-snug line-clamp-1">
        {template.description}
      </p>
      <span className="mt-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-theme-ink/5 text-theme-muted font-sans text-[10px] font-semibold uppercase tracking-kicker">
        <span className="leading-none">{cat.icon}</span>
        <span>{cat.label}</span>
      </span>
    </button>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────────────

interface TemplateFormModalProps {
  template: Template
  onCancel: () => void
  onSubmit: (prompt: string) => void
}

function TemplateFormModal({ template, onCancel, onSubmit }: TemplateFormModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.fields.map((f) => [f.key, '']))
  )

  // Escape ferme la modale
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const finalPrompt = renderTemplatePrompt(template, values)
    onSubmit(finalPrompt)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-theme-ink/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-theme-bg text-theme-ink w-full sm:max-w-lg rounded-t-3xl sm:rounded-sm shadow-2xl overflow-hidden border border-theme-border max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — kicker + double rule + close */}
        <div className="px-7 pt-6 pb-2 flex items-center justify-between flex-shrink-0">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {CATEGORY_LABELS[template.category].icon} {CATEGORY_LABELS[template.category].label}
          </span>
          <button
            onClick={onCancel}
            className="text-theme-muted hover:text-theme-ink rounded p-1 transition-colors"
            aria-label="Fermer"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mx-7 h-[2px] bg-theme-ink flex-shrink-0" />
        <div className="mx-7 mt-[3px] h-px bg-theme-ink flex-shrink-0" />

        {/* Title */}
        <div className="px-7 pt-5 pb-1 flex-shrink-0">
          <h2 className="font-display font-medium text-[26px] leading-[1.05] -tracking-[0.02em] text-theme-ink">
            {template.title}
          </h2>
          <p className="font-display italic text-theme-muted text-sm mt-1.5 leading-relaxed">
            {template.description}
          </p>
        </div>

        {/* Form scrollable */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div
            className="flex-1 overflow-y-auto px-7 pt-5 pb-4 space-y-5"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 1rem))' }}
          >
            {template.fields.map((field, idx) => (
              <div key={field.key}>
                <label
                  htmlFor={`tpl-${template.id}-${field.key}`}
                  className="block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1.5"
                >
                  {field.label}
                </label>
                {field.multiline ? (
                  <textarea
                    id={`tpl-${template.id}-${field.key}`}
                    value={values[field.key] ?? ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    rows={4}
                    autoFocus={idx === 0}
                    className="w-full bg-transparent border border-theme-ink/20 rounded-sm py-2 px-3 font-display text-[15px] text-theme-ink placeholder:text-theme-muted placeholder:font-display placeholder:italic focus:outline-none focus:border-theme-accent transition-colors resize-y"
                  />
                ) : (
                  <input
                    id={`tpl-${template.id}-${field.key}`}
                    type="text"
                    value={values[field.key] ?? ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    autoFocus={idx === 0}
                    className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2 font-display text-[16px] text-theme-ink placeholder:text-theme-muted placeholder:font-display placeholder:italic focus:outline-none focus:border-theme-accent transition-colors"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Footer actions */}
          <div
            className="px-7 pt-3 pb-5 flex flex-col gap-2.5 border-t border-theme-border bg-theme-bg flex-shrink-0"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 1.25rem))' }}
          >
            <button
              type="submit"
              className="w-full py-3.5 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90"
            >
              Utiliser ce template →
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="w-full font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors text-center"
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export const TemplatesScreen = memo(TemplatesScreenInner)
