import i18n from '../i18n'
import type { UrlReaderFailure } from './pdfUrlFetch'

export function describeUrlReaderFailure(failure: UrlReaderFailure): string {
  const reason = failure.reason
  const key = reason === 'site_security' ? 'security' : reason === 'blocked' ? 'refused'
    : ['guardrail', 'restricted_navigation'].includes(reason) ? 'policy'
    : reason === 'http_error' ? 'httpError' : reason === 'wrong_page' ? 'wrongPage' : reason === 'login_required' ? 'login'
    : ['missing_body', 'missing_post_body'].includes(reason) ? 'missing'
    : reason === 'unsupported_content' ? 'format' : reason === 'timeout' ? 'timeout'
    : reason.endsWith('_failed') ? 'technical' : 'unknown'
  const status = failure.upstreamHttpStatus ? ` (HTTP ${failure.upstreamHttpStatus})` : ''
  return i18n.t(`errors.urlReader.${key}`, { status })
}

export function formatUrlReaderFailures(failures: UrlReaderFailure[] = []): string {
  return failures.map(failure => `${failure.url} : ${describeUrlReaderFailure(failure)}`).join('\n')
}
