// P1.8 — modale d'édition des étiquettes d'une conversation. Version SÛRE :
// jeu prédéfini (toggle) + un tag perso normalisé, plafonné. La couleur est une
// pastille (●), lisible en thème clair comme sombre.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialogFocusTrap } from '../../hooks/useDialogFocusTrap'
import {
  PREDEFINED_TAGS,
  resolveTag,
  addTag,
  removeTag,
  normalizeCustomTag,
  MAX_TAGS_PER_CONVERSATION,
  MAX_CUSTOM_TAG_LENGTH,
} from '../../services/conversationTags'

interface Props {
  tags: string[]
  onSave: (tags: string[]) => void
  onClose: () => void
}

export function ConversationTagsModal({ tags, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const dialogRef = useDialogFocusTrap<HTMLDivElement>(true, onClose)
  const [selected, setSelected] = useState<string[]>(tags)
  const [custom, setCustom] = useState('')

  const isSelected = (value: string) => selected.some((x) => x.toLowerCase() === value.toLowerCase())
  const toggle = (value: string) =>
    setSelected((cur) => (isSelected(value) ? removeTag(cur, value) : addTag(cur, value)))
  const addCustom = () => {
    const norm = normalizeCustomTag(custom)
    if (!norm) return
    setSelected((cur) => addTag(cur, norm))
    setCustom('')
  }
  const full = selected.length >= MAX_TAGS_PER_CONVERSATION

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-theme-ink/50"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-tags-title"
        tabIndex={-1}
        className="w-full max-w-sm space-y-4 border border-theme-border bg-theme-bg p-5 text-theme-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p id="conversation-tags-title" className="font-display text-base text-theme-ink">{t('tags.modalTitle')}</p>
          <p className="font-display italic text-xs text-theme-muted mt-0.5">
            {t('tags.modalHint', { max: MAX_TAGS_PER_CONVERSATION })}
          </p>
        </div>

        {/* Étiquettes posées (clic = retirer) */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((tag) => {
              const r = resolveTag(tag, t)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggle(tag)}
                  className="flex min-h-11 items-center gap-1 border border-theme-border bg-theme-ink/5 px-2 py-1 text-[11px] text-theme-ink transition-colors hover:bg-theme-ink/10"
                  aria-label={t('tags.remove', { tag: r.label })}
                >
                  <span aria-hidden style={{ color: r.color }}>●</span>
                  <span className="truncate max-w-[120px]">{r.label}</span>
                  <span className="text-theme-muted" aria-hidden>×</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Tags prédéfinis */}
        <div className="flex flex-wrap gap-1.5">
          {PREDEFINED_TAGS.map((def) => {
            const on = isSelected(def.id)
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => toggle(def.id)}
                disabled={!on && full}
                className={`flex min-h-11 items-center gap-1 border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40 ${
                  on
                    ? 'border-theme-accent bg-theme-accent/10 text-theme-ink'
                    : 'border-theme-border text-theme-muted hover:text-theme-ink'
                }`}
              >
                <span aria-hidden style={{ color: def.color }}>●</span>
                {t(def.labelKey)}
              </button>
            )
          })}
        </div>

        {/* Tag personnalisé */}
        <div className="flex items-center gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            maxLength={MAX_CUSTOM_TAG_LENGTH}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder={t('tags.customPlaceholder')}
            disabled={full}
            className="min-h-11 min-w-0 flex-1 border border-theme-border bg-theme-surface px-2 py-1.5 text-[13px] text-theme-ink outline-none focus:border-theme-accent disabled:opacity-40"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={full || !custom.trim()}
            className="min-h-11 border border-theme-ink bg-theme-ink px-3 py-1.5 text-[12px] text-theme-bg disabled:opacity-40"
          >
            {t('tags.add')}
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 border border-transparent px-3 py-2 text-[13px] text-theme-muted hover:border-theme-border hover:text-theme-ink"
          >
            {t('tags.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSave(selected)}
            className="min-h-11 border border-theme-accent bg-theme-accent px-4 py-2 text-[13px] font-medium text-theme-bg"
          >
            {t('tags.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
