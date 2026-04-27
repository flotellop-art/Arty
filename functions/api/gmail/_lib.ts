// ─────────────────────────────────────────────────────────────────────
// Body decoding helpers (BUG 49)
//
// Email parts arrive base64url-encoded with a charset declared in the
// part's `Content-Type` header (often windows-1252 or ISO-8859-1 from
// Outlook-derived garage/ERP software). Decoding everything as UTF-8
// silently turned every accent into U+FFFD, so French body text
// looked like "C?est un d?vis pour la r?paration" — Claude assumed
// the email was unreadable and the user got "Non lisible".
// ─────────────────────────────────────────────────────────────────────

export interface MimePart {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: MimePart[]
  headers?: Array<{ name: string; value: string }>
}

export function getCharset(part: MimePart): string {
  const ct = part.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value || ''
  const m = /charset\s*=\s*"?([^";]+)"?/i.exec(ct)
  return (m?.[1] || 'utf-8').toLowerCase()
}

/** base64url → bytes (Workers' Buffer doesn't always handle 'base64url'). */
export function decodeBase64Url(data: string): Uint8Array {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

export function decodePartBody(part: MimePart): string {
  if (!part.body?.data) return ''
  const bytes = decodeBase64Url(part.body.data)
  const charset = getCharset(part)
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

/**
 * HTML → text that's actually useful for Claude. The previous
 * implementation kept the contents of <style> and <script> blocks
 * intact (Outlook 365 ships 3-8KB of inline CSS at the top of every
 * email), so the slice(0, 5000) cut off the actual content. We also
 * decode the most common HTML entities — without this, "&nbsp;",
 * "&eacute;" etc. leaked into the rendered text.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
