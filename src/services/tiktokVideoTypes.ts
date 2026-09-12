// Shared with the server. No browser state or credentials in this module.
export const TIKTOK_MAX_SECONDS = 600
export const TIKTOK_ANALYSIS_MODEL = 'gemini-3.8-flash'
export const TIKTOK_MAX_BYTES = 128 * 1024 * 1024
export const TIKTOK_CLIENT_TIMEOUT_MS = 195_000
export const TIKTOK_SERVER_TIMEOUT_MS = 180_000
export const TIKTOK_PREPARATION_TIMEOUT_MS = 90_000
export const TIKTOK_GENERATION_TIMEOUT_MS = 80_000
export const TIKTOK_MAX_ANALYSIS_CHARS = 24_000
export interface TikTokAnalysis {
  url: string
  text: string
  model: string
  analyzedAt: number
}

export function normalizeTikTokUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
    const short = (u.hostname === 'vm.tiktok.com' || u.hostname === 'vt.tiktok.com')
      && /^\/[A-Za-z0-9]{4,64}\/?$/.test(u.pathname)
    const full = (u.hostname === 'www.tiktok.com' || u.hostname === 'tiktok.com')
      && (/^\/@[A-Za-z0-9._-]{1,64}\/video\/\d{15,25}\/?$/.test(u.pathname)
        || /^\/t\/[A-Za-z0-9]{4,64}\/?$/.test(u.pathname))
    if (!short && !full) return null
    return `${u.origin}${u.pathname}`
  } catch { return null }
}

export function extractTikTokUrls(text: string): string[] {
  return [...new Set((text.match(/https:\/\/[^\s<>"'`]+/gi) ?? [])
    .map(raw => normalizeTikTokUrl(raw.replace(/[).,;!?]+$/, '')))
    .filter((url): url is string => url !== null))]
}

export function validTikTokAnalysis(value: unknown): value is TikTokAnalysis {
  if (!value || typeof value !== 'object') return false
  const v = value as TikTokAnalysis
  return normalizeTikTokUrl(v.url) === v.url && typeof v.text === 'string'
    && v.text.trim().length > 0 && v.text.length <= TIKTOK_MAX_ANALYSIS_CHARS
    && typeof v.model === 'string' && /^[a-zA-Z0-9.-]{1,100}$/.test(v.model)
    && Number.isSafeInteger(v.analyzedAt) && v.analyzedAt >= 0
}
