import { useTranslation } from 'react-i18next'
import { setLocale, getLocale, SUPPORTED_LOCALES, type Locale } from '../../i18n'

const FLAGS: Record<Locale, string> = {
  fr: '🇫🇷',
  en: '🇬🇧',
}

/**
 * Petit sélecteur de langue FR / EN.
 * Affiché en bas de la sidebar. Persiste le choix en localStorage via setLocale.
 */
export function LanguageSelector() {
  const { t, i18n } = useTranslation()
  const active = (i18n.resolvedLanguage?.slice(0, 2) || getLocale()) as Locale

  return (
    <div className="flex items-center justify-between px-5 py-2 border-t border-theme-border">
      <span className="text-xs text-theme-muted">{t('sidebar.language')}</span>
      <div className="flex gap-1">
        {SUPPORTED_LOCALES.map((loc) => (
          <button
            key={loc}
            onClick={() => setLocale(loc)}
            className={`text-base px-1.5 py-0.5 rounded transition-opacity ${
              active === loc ? 'opacity-100' : 'opacity-40 hover:opacity-70'
            }`}
            aria-label={loc.toUpperCase()}
            aria-pressed={active === loc}
          >
            {FLAGS[loc]}
          </button>
        ))}
      </div>
    </div>
  )
}
