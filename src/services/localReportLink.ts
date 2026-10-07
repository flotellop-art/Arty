// Reports live in this app's storage, not on a public web server. Only accept
// the canonical URL emitted by generate_report (or its relative route).
export function localReportPath(value: string): string | null {
  if (typeof window === 'undefined') return null
  const path = value.startsWith(`${window.location.origin}/`)
    ? value.slice(window.location.origin.length)
    : value
  return /^\/report\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(path)
    ? path
    : null
}
