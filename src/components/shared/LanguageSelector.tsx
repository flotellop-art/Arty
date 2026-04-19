import { useTranslation } from 'react-i18next'
import { setLocale, getLocale, SUPPORTED_LOCALES, type Locale } from '../../i18n'
import { Tag } from './editorial'

const LABELS: Record<Locale, string> = {
  fr: 'FR',
  en: 'EN',
}

/**
 * Sélecteur de langue FR / EN en bas de la sidebar. Persiste via setLocale.
 */
export function LanguageSelector() {
  const { t, i18n } = useTranslation()
  const active = (i18n.resolvedLanguage?.slice(0, 2) || getLocale()) as Locale

  return (
    <div
      className="flex items-center justify-between px-5 py-2"
      style={{ borderTop: '1px solid var(--arty-line)' }}
    >
      <Tag>{t('sidebar.language')}</Tag>
      <div
        className="flex gap-0 p-0.5"
        style={{ backgroundColor: 'var(--arty-card)', border: '1px solid var(--arty-line)', borderRadius: 2 }}
      >
        {SUPPORTED_LOCALES.map((loc) => (
          <button
            key={loc}
            onClick={() => setLocale(loc)}
            className="text-[11px] tracking-[0.12em] font-sans font-semibold px-2 py-1 transition-colors"
            style={{
              backgroundColor: active === loc ? 'var(--arty-ink)' : 'transparent',
              color: active === loc ? 'var(--arty-bg)' : 'var(--arty-ink-soft)',
              borderRadius: 2,
            }}
            aria-label={loc.toUpperCase()}
            aria-pressed={active === loc}
          >
            {LABELS[loc]}
          </button>
        ))}
      </div>
    </div>
  )
}
