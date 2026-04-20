/**
 * ProfileSetupModal — first-login onboarding popup that asks the user
 * for their first name and date of birth, so the Home hero can greet
 * them properly ("Bonjour *Florent.*") instead of showing the API key
 * preview ("Bonjour sk-ant-api…") for apikey-only logins.
 *
 * Visuals follow the Ember editorial handoff: kicker + double rule +
 * Fraunces italic hero + underline inputs + ink italic CTA. Same
 * language as Login / Home / Brief modals.
 */

import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setUserProfile, skipUserProfile } from '../../services/userProfile'

interface ProfileSetupModalProps {
  onClose: () => void
}

function ProfileSetupModalInner({ onClose }: ProfileSetupModalProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)

  // Close on Escape (saves as skipped so the modal doesn't loop)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        skipUserProfile()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) return
    setSaving(true)
    setUserProfile({ name: trimmedName, dob: dob.trim() })
    onClose()
  }

  const handleSkip = () => {
    skipUserProfile()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-theme-ink/40 backdrop-blur-sm"
      onClick={handleSkip}
    >
      <div
        className="bg-theme-bg text-theme-ink w-full sm:max-w-md rounded-t-3xl sm:rounded-sm shadow-2xl overflow-hidden border border-theme-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Editorial header — kicker + double rule */}
        <div className="px-7 pt-6 pb-2 flex items-center justify-between">
          <span className="font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted">
            {t('profileSetup.kicker', { defaultValue: 'Édition privée · Vol. 1' })}
          </span>
          <button
            onClick={handleSkip}
            className="text-theme-muted hover:text-theme-ink rounded p-1 transition-colors"
            aria-label={t('common.close')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mx-7 h-[2px] bg-theme-ink" />
        <div className="mx-7 mt-[3px] h-px bg-theme-ink" />

        {/* Hero Fraunces — "Faisons *connaissance.*" */}
        <div className="px-7 pt-7 pb-2">
          <h1 className="font-display font-medium text-[34px] leading-[1.02] -tracking-[0.02em] text-theme-ink">
            {t('profileSetup.titlePart1', { defaultValue: 'Faisons' })}
            <br />
            <span className="italic">
              {t('profileSetup.titlePart2', { defaultValue: 'connaissance' })}
            </span>
            <span className="text-theme-accent">.</span>
          </h1>
          <p className="font-display italic text-theme-muted text-base mt-2 leading-relaxed">
            {t('profileSetup.subtitle', {
              defaultValue: 'Juste de quoi personnaliser nos échanges. Ça reste sur cet appareil.',
            })}
          </p>
        </div>

        {/* Form — underline editorial inputs */}
        <form onSubmit={handleSubmit} className="px-7 pt-6 pb-7 space-y-6">
          <div>
            <label
              htmlFor="profile-name"
              className="block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1.5"
            >
              {t('profileSetup.nameLabel', { defaultValue: 'Prénom' })}
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('profileSetup.namePlaceholder', { defaultValue: 'Florent' })}
              autoComplete="given-name"
              autoFocus
              className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2.5 font-display text-[17px] text-theme-ink placeholder:text-theme-muted/50 placeholder:font-display placeholder:italic focus:outline-none focus:border-theme-accent transition-colors"
            />
          </div>

          <div>
            <label
              htmlFor="profile-dob"
              className="block font-sans text-[10px] font-semibold uppercase tracking-kicker text-theme-muted mb-1.5"
            >
              {t('profileSetup.dobLabel', { defaultValue: 'Date de naissance' })}
              <span className="ml-2 font-display italic text-theme-muted/70 normal-case tracking-normal">
                {t('profileSetup.optional', { defaultValue: 'optionnel' })}
              </span>
            </label>
            <input
              id="profile-dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              autoComplete="bday"
              className="w-full bg-transparent border-0 border-b border-theme-ink/40 py-2.5 font-mono text-sm text-theme-ink placeholder:text-theme-muted/50 focus:outline-none focus:border-theme-accent transition-colors [color-scheme:inherit]"
            />
          </div>

          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="w-full py-4 font-display italic text-base font-medium tracking-[0.02em] bg-theme-ink text-theme-bg rounded-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving
              ? t('profileSetup.saving', { defaultValue: 'Enregistrement…' })
              : `${t('profileSetup.submit', { defaultValue: 'Continuer' })} →`}
          </button>

          <button
            type="button"
            onClick={handleSkip}
            className="w-full font-display italic text-[13px] text-theme-muted hover:text-theme-ink transition-colors text-center"
          >
            {t('profileSetup.skip', { defaultValue: 'Passer pour l\'instant' })}
          </button>
        </form>
      </div>
    </div>
  )
}

export const ProfileSetupModal = memo(ProfileSetupModalInner)
