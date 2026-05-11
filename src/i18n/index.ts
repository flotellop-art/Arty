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

/**
 * Synchronise l'attribut `<html lang>` avec la locale courante. Sans ça :
 * - les lecteurs d'écran prononcent le texte avec l'accent du `lang` initial
 *   (hardcodé `fr` dans index.html), même quand l'user a basculé en anglais ;
 * - Chrome propose "Traduire cette page" depuis le mauvais source ;
 * - les feuilles de style `:lang()` ne matchent pas correctement.
 * H-UX-6 (audit étape 10). Fire au boot (via `initialized`) ET sur chaque
 * changement (via `languageChanged`) — couvre les 2 cas sans race.
 */
function syncHtmlLang(lng: string): void {
  try {
    const locale = lng.slice(0, 2)
    document.documentElement.lang = (SUPPORTED_LOCALES as readonly string[]).includes(locale)
      ? locale
      : 'fr'
  } catch { /* SSR / no document */ }
}

i18n.on('languageChanged', syncHtmlLang)
i18n.on('initialized', () => syncHtmlLang(i18n.language || 'fr'))

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
