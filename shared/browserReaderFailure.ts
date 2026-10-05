export const BROWSER_READ_REASONS = [
  'not_read', 'blocked', 'site_security', 'http_error', 'guardrail', 'restricted_navigation',
  'wrong_page', 'login_required', 'missing_body', 'missing_post_body',
  'unsupported_content', 'timeout', 'acquisition_failed', 'session_tracking_failed',
  'connection_failed', 'setup_failed', 'navigation_failed', 'extraction_failed',
] as const
export type BrowserReadReason = typeof BROWSER_READ_REASONS[number]
export const BROWSER_READ_STAGES = ['acquisition', 'session_tracking', 'connection', 'setup', 'navigation', 'extraction'] as const
export type BrowserReadStage = typeof BROWSER_READ_STAGES[number]
export interface BrowserReadFailure { reason: BrowserReadReason; stage?: BrowserReadStage; upstreamHttpStatus?: number }

/** Closed wire contract: never carry provider error text, HTML or session IDs. */
export function parseBrowserReadFailure(value: unknown): BrowserReadFailure | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.provider !== 'arty-browser' || !BROWSER_READ_REASONS.includes(data.reason as BrowserReadReason)) return null
  const result: BrowserReadFailure = { reason: data.reason as BrowserReadReason }
  if (BROWSER_READ_STAGES.includes(data.stage as BrowserReadStage)) result.stage = data.stage as BrowserReadStage
  if (typeof data.upstreamHttpStatus === 'number' && Number.isInteger(data.upstreamHttpStatus)
    && data.upstreamHttpStatus >= 100 && data.upstreamHttpStatus <= 599) result.upstreamHttpStatus = data.upstreamHttpStatus
  return result
}
