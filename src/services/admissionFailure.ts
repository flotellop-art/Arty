import i18n from '../i18n'

/** A refused, unconfirmed admission is retryable by the user, not by the
 * automatic provider fallback loop. It is neither an expired trial nor logout.
 */
export function admissionUnavailableError(status: number, body: string): Error | null {
  if (status !== 503 && status !== 400 && status !== 409) return null
  try {
    const code = JSON.parse(body)?.error
    if (status === 409 && code === 'continuation_funding_changed') return Object.assign(
      new Error(i18n.t('errors.continuationFundingChanged')), { name: 'ContinuationFundingChangedError' },
    )
    if (status === 400 && code === 'continuation_funding_required') return Object.assign(
      new Error(i18n.t('errors.continuationUnavailable')), { name: 'ContinuationUnavailableError' },
    )
    if (status === 400 && code === 'subsidized_request_unsupported') return Object.assign(
      new Error(i18n.t('errors.subsidizedRequestUnsupported')), { name: 'SubsidizedRequestUnsupportedError' },
    )
    if (status !== 503) return null
    if (code === 'subsidized_budget_exhausted') return Object.assign(
      new Error(i18n.t('errors.subsidizedBudgetExhausted')), { name: 'SubsidizedBudgetExhaustedError' },
    )
    if (code !== 'admission_unavailable') return null
    return Object.assign(new Error(i18n.t('errors.admissionUnavailable')), { name: 'AdmissionUnavailableError' })
  } catch { return null }
}
