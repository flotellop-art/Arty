/**
 * Format a raw session displayName for UI display.
 *
 * Login flows store different things in `displayName`:
 *   - API-key login  → `anthropicKey.slice(0, 10) + '...'` ("sk-ant-api03-...")
 *   - Email login    → email
 *   - Google login   → user's real name
 *
 * We don't want to show API key previews or raw emails in headings /
 * greetings. This returns the "clean" display form, or an empty string
 * when the name isn't usable — callers should then fall back to a
 * generic label.
 */
const API_KEY_PREFIXES = /^(sk-|gk-|AIza|pk-|k-)/i
const SUSPICIOUS = /[.…~/\\]/

export function cleanDisplayName(raw: string | null | undefined): string {
  const value = (raw || '').trim()
  if (!value) return ''
  if (API_KEY_PREFIXES.test(value)) return ''
  if (value.includes('@')) return ''
  const firstWord = value.split(/\s+/)[0] || ''
  if (!firstWord || firstWord.length > 32) return ''
  if (SUSPICIOUS.test(firstWord)) return ''
  return value
}

/**
 * First word only, for the Home hero that splits "Bonjour Florent".
 * Empty when the value can't produce a safe first name.
 */
export function cleanFirstName(raw: string | null | undefined): string {
  const clean = cleanDisplayName(raw)
  if (!clean) return ''
  return clean.split(/\s+/)[0] || ''
}
