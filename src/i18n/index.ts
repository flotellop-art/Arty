import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import fr from './locales/fr.json'
import en from './locales/en.json'

// Clé localStorage globale (pas scopée par user — on veut la langue choisie
// avant même qu'un user soit actif, par ex. sur LoginScreen)
const LOCALE_STORAGE_KEY = 'arty-locale'

export const SUPPORTED_LOCALES = ['fr', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    fallbackLng: 'fr',
    supportedLngs: SUPPORTED_LOCALES,
    load: 'languageOnly', // "fr-FR" → "fr", "en-US" → "en"
    nonExplicitSupportedLngs: true,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
    },
    interpolation: {
      escapeValue: false, // React fait déjà l'échappement
    },
    returnNull: false,
  })

/** Change la langue courante et persiste en localStorage. */
export function setLocale(locale: Locale): void {
  i18n.changeLanguage(locale)
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* quota / private mode — on ignore */
  }
}

/** Locale courante, toujours dans SUPPORTED_LOCALES. */
export function getLocale(): Locale {
  const lng = (i18n.resolvedLanguage || i18n.language || 'fr').slice(0, 2)
  return (SUPPORTED_LOCALES as readonly string[]).includes(lng)
    ? (lng as Locale)
    : 'fr'
}

export default i18n
