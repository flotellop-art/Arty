import i18n from '../i18n'

/**
 * Locale BCP-47 dérivée de la langue i18next courante. 'fr' → 'fr-FR',
 * 'en' → 'en-US'. Centralise le mapping pour éviter les `'fr-FR'` hardcodés
 * un peu partout (audit étape 11). Quand l'user passe en anglais, toutes
 * les dates basculent automatiquement.
 */
export function getDateLocale(): string {
  const lng = (i18n.language || 'fr').slice(0, 2)
  switch (lng) {
    case 'en': return 'en-US'
    case 'fr': return 'fr-FR'
    default: return 'fr-FR'
  }
}

/**
 * Formate une date avec la locale courante. Wrapper autour de
 * `toLocaleDateString` pour ne plus avoir à se soucier de la locale dans
 * chaque appelant.
 */
export function formatDate(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString(getDateLocale(), options)
}

/**
 * Formate une heure avec la locale courante.
 */
export function formatTime(date: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleTimeString(getDateLocale(), options)
}
