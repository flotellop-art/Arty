/**
 * Modale de signalement d'une réponse IA (policy Play Store « AI-Generated
 * Content » : signalement in-app obligatoire, sans quitter l'app).
 *
 * Catégorie obligatoire + champ libre optionnel + ligne de transparence
 * TOUJOURS visible (le rapport part vers l'équipe Arty, base EU — jamais de
 * bascule silencieuse). Fonctionne aussi sur les conversations euOnly :
 * c'est un rapport privé vers le développeur, pas une publication.
 */

import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation, Message } from '../../types'
import {
  REPORT_CATEGORIES,
  buildReportPayload,
  submitReport,
  type ReportCategory,
} from '../../services/reportClient'
import { toast } from '../../services/toast'

const MAX_FREE_TEXT_CHARS = 500

interface ReportModalProps {
  conversation: Conversation
  message: Message | null
  onClose: () => void
}

export const ReportModal = memo(function ReportModal({ conversation, message, onClose }: ReportModalProps) {
  const { t } = useTranslation()
  const [category, setCategory] = useState<ReportCategory | null>(null)
  const [freeText, setFreeText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (message) { setCategory(null); setFreeText(''); setBusy(false) }
  }, [message])

  useEffect(() => {
    if (!message) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [message, onClose])

  if (!message) return null

  const send = async () => {
    if (busy || !category) return
    setBusy(true)
    const res = await submitReport(buildReportPayload(conversation, message, category, freeText))
    setBusy(false)
    if (!res.ok) {
      const key =
        res.code === 'rate_limit' ? 'report.errorRateLimit'
        : res.code === 'auth' ? 'report.errorAuth'
        : 'report.errorFailed'
      toast(t(key), 'error')
      return
    }
    toast(t('report.success'), 'success')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        className="bg-theme-bg border border-theme-border rounded-2xl shadow-xl max-w-sm w-[90%] mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="report-modal-title" className="font-display text-xl text-theme-ink mb-3">
          🚩 {t('report.title')}
        </h3>

        <div className="flex flex-col gap-1.5 mb-4" role="radiogroup" aria-label={t('report.title')}>
          {REPORT_CATEGORIES.map((c) => (
            <label
              key={c}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                category === c
                  ? 'border-theme-accent bg-theme-accent/10'
                  : 'border-theme-border hover:border-theme-accent/50'
              }`}
            >
              <input
                type="radio"
                name="report-category"
                checked={category === c}
                onChange={() => setCategory(c)}
                className="accent-[rgb(var(--theme-accent))] w-3.5 h-3.5 shrink-0"
              />
              <span className="text-sm text-theme-ink">{t(`report.categories.${c}`)}</span>
            </label>
          ))}
        </div>

        <label className="block mb-4">
          <span className="text-xs text-theme-muted">{t('report.freeTextLabel')}</span>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value.slice(0, MAX_FREE_TEXT_CHARS))}
            placeholder={t('report.freeTextPlaceholder')}
            rows={2}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-theme-surface border border-theme-border text-sm text-theme-ink placeholder:text-theme-muted focus:outline-none focus:border-theme-accent resize-none"
          />
        </label>

        <p className="text-[11px] text-theme-muted leading-relaxed mb-5">{t('report.disclosure')}</p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-ink transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={send}
            disabled={!category || busy}
            className="px-4 py-1.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {busy ? t('report.submitting') : t('report.submit')}
          </button>
        </div>
      </div>
    </div>
  )
})
