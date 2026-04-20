/**
 * Cleans a stored displayName before showing it in the UI.
 *
 * When a user logs in via the "API key" tab we historically stored the
 * first 10 chars of the key (e.g. "sk-ant-api...") as the displayName.
 * Showing that verbatim in the Home greeting or the Sidebar footer leaks
 * part of the secret and looks broken ("Bonjour sk-ant-api…").
 *
 * This helper returns:
 *   - `null` when the value should be hidden entirely (API key preview,
 *     raw email address, empty/garbage)
 *   - otherwise the first word, trimmed, ready to display
 *
 * Use it at EVERY read site (Sidebar, HomeScreen, TopBar, etc.) — never
 * re-implement the rules inline. The old inline filter in HomeScreen is
 * replaced by this one.
 */
export function cleanDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v) return null

  // API key previews: "sk-…", "sk-ant-…", "gk-…", "AIza…", "pk-…", "k-…"
  if (/^(sk-|gk-|AIza|pk-|k-)/i.test(v)) return null

  // Raw email address — we don't want to greet "Bonjour foo@bar.com"
  if (v.includes('@')) return null

  // Keep the first word, reject anything suspicious (URL-like, path-like)
  const firstWord = v.split(/\s+/)[0] || ''
  if (!firstWord) return null
  if (firstWord.length > 24) return null
  if (/[.…~/\\]/.test(firstWord)) return null

  return firstWord
}
