import i18n from '../i18n'

/** A refused, unconfirmed admission is retryable by the user, not by the
 * automatic provider fallback loop. It is neither an expired trial nor logout.
 */
export function admissionUnavailableError(status: number, body: string): Error | null {
  if (status !== 503) return null
  try {
    if (JSON.parse(body)?.error !== 'admission_unavailable') return null
    return Object.assign(new Error(i18n.t('errors.admissionUnavailable')), { name: 'AdmissionUnavailableError' })
  } catch { return null }
}
