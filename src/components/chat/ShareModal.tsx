/**
 * P1.5 — Modale de partage public.
 *
 * Publier = acte EXPLICITE et conscient (la posture privacy d'Arty l'exige) :
 * avertissement clair + case à cocher non pré-cochée + mention renforcée si la
 * conversation contient des données Google. euOnly → refus net.
 * À la confirmation : crée le lien public et le partage (Web Share / copie).
 */

import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Conversation } from '../../types'
import { createShare, shareConsentKey } from '../../services/shareClient'
import { hasProjectHistory, isProjectEU } from '../../services/projects/chatPolicy'
import { shareContent } from '../../services/native/share'
import { toast } from '../../services/toast'

interface ShareModalProps {
  conversation: Conversation | null
  open: boolean
  onClose: () => void
}

export const ShareModal = memo(function ShareModal({ conversation, open, onClose }: ShareModalProps) {
  const { t } = useTranslation()
  const [agreed, setAgreed] = useState(false)
  const [approvedKey, setApprovedKey] = useState<string | null>(null)
  const consentKey = conversation ? shareConsentKey(conversation) : ''
  const currentKey = useRef(consentKey), mounted = useRef(true)
  const generation = useRef(0)
  const [engaged, setEngaged] = useState(false)
  currentKey.current = open ? consentKey : ''
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    generation.current++
    if (open) { setAgreed(false); setApprovedKey(null); setUrl(null); setBusy(false); setEngaged(false) }
  }, [open, consentKey])

  const close = () => { generation.current++; setBusy(false); onClose() }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !conversation) return null

  const isEu = isProjectEU(conversation)
  const hasGoogle = !!conversation.hasGoogleData

  const publish = async () => {
    if (busy || !agreed || approvedKey !== consentKey) return
    const run = ++generation.current
    const current = () => mounted.current && currentKey.current === consentKey && generation.current === run
    setBusy(true)
    const res = await createShare(conversation, { isCurrent: current, onEngaged: () => { if (current()) setEngaged(true) } })
    if (!current()) return
    setBusy(false)
    if (!res.ok || !res.url) {
      const key =
        res.code === 'rate_limit' ? 'share.errorRateLimit'
        : res.code === 'too_large' ? 'share.errorTooLarge'
        : res.code === 'eu_blocked' ? 'share.errorEu'
        : res.code === 'auth' ? 'share.errorAuth'
        : 'share.errorFailed'
      toast(t(key), 'error')
      return
    }
    setUrl(res.url)
    // Partage natif (feuille de partage) ou copie presse-papier.
    const shared = await shareContent({ title: conversation.title, url: res.url, dialogTitle: t('share.dialogTitle') })
    if (!current()) return
    if (!shared) {
      try {
        await navigator.clipboard.writeText(res.url)
        if (!current()) return
        toast(t('share.copied'), 'success')
      } catch { /* l'URL reste affichée pour copie manuelle */ }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-theme-bg border border-theme-border rounded-2xl shadow-xl max-w-sm w-[90%] mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-xl text-theme-ink mb-3">🔗 {t('share.title')}</h3>

        {isEu ? (
          <>
            <p className="text-sm text-theme-muted leading-relaxed mb-5">{t('share.euBlocked')}</p>
            <div className="flex justify-end">
              <button onClick={close} className="px-4 py-1.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg rounded-md">
                {t('common.ok')}
              </button>
            </div>
          </>
        ) : url ? (
          <>
            <p className="text-sm text-theme-ink leading-relaxed mb-2">{t('share.success')}</p>
            <div className="px-3 py-2 rounded-lg bg-theme-surface border border-theme-border text-xs text-theme-ink break-all mb-2 select-all">{url}</div>
            <p className="text-[11px] text-theme-muted mb-5">{t('share.expiry')}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { navigator.clipboard?.writeText(url).then(() => toast(t('share.copied'), 'success')).catch(() => {}) }}
                className="px-3 py-1.5 text-xs font-sans uppercase tracking-kicker border border-theme-border text-theme-ink rounded-md hover:border-theme-accent transition-colors"
              >
                {t('share.copyLink')}
              </button>
              <button onClick={close} className="px-4 py-1.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg rounded-md">
                {t('common.done')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-theme-muted leading-relaxed mb-3">{t('share.warning')}</p>
            {engaged && <p role="status" className="text-sm mb-3">{t('share.publicationEngaged')}</p>}
            {hasProjectHistory(conversation) && <p className="text-sm text-red-700 dark:text-red-400 mb-3">{t('share.projectWarning')}</p>}
            {hasGoogle && (
              <p className="text-sm text-amber-600 leading-relaxed mb-3">⚠️ {t('share.googleWarning')}</p>
            )}
            <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
              <input
                type="checkbox"
                disabled={busy}
                checked={agreed}
                onChange={(e) => { setAgreed(e.target.checked); setApprovedKey(e.target.checked ? consentKey : null) }}
                className="mt-0.5 accent-[rgb(var(--theme-accent))] w-4 h-4 shrink-0"
              />
              <span className="text-xs text-theme-ink leading-relaxed">{t('share.consent')}</span>
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={close} className="px-3 py-1.5 text-xs font-sans uppercase tracking-kicker text-theme-muted hover:text-theme-ink transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={publish}
                disabled={!agreed || approvedKey !== consentKey || busy}
                className="px-4 py-1.5 text-xs font-sans uppercase tracking-kicker bg-theme-accent text-theme-bg rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {busy ? t('share.publishing') : t('share.publish')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
})
