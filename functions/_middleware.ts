const CANONICAL_ORIGIN = 'https://tryarty.com'
export const LEGACY_API_HOST = 'appfacade.pages.dev'

// Public hosts that previously served the production application. Cloudflare
// preview deployments remain available because their host is a subdomain of
// appfacade.pages.dev, not the exact project hostname below.
export const LEGACY_PUBLIC_HOSTS = new Set([
  LEGACY_API_HOST,
  'www.tryarty.com',
])

export function canonicalRedirect(request: Request): Response | null {
  const source = new URL(request.url)
  if (!LEGACY_PUBLIC_HOSTS.has(source.hostname.toLowerCase())) return null

  // Installed APKs may still call this API host. A redirect can break native
  // CORS preflights even when 308 preserves POST bodies. Pass the ORIGINAL
  // request to the existing API middleware/handlers for every method: their
  // Origin, auth, captcha, quota and webhook HMAC gates remain authoritative.
  // This is an API transport host, NOT a new allowed browser Origin. Keep it
  // classified as production in emailTrial.ts (fail-closed Turnstile).
  if (
    source.hostname.toLowerCase() === LEGACY_API_HOST
    && (source.pathname === '/api' || source.pathname.startsWith('/api/'))
  ) {
    return null
  }

  // Affecter pathname/search séparément : `new URL('//evil.example', base)`
  // interpréterait un chemin à double slash comme une nouvelle origine.
  const target = new URL(CANONICAL_ORIGIN)
  target.pathname = source.pathname
  target.search = source.search
  return new Response(null, {
    // 308 preserves the method/body while permanently canonicalising normal
    // browser navigation and search-engine signals.
    status: 308,
    headers: {
      Location: target.toString(),
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

export const onRequest: PagesFunction = async (context) => {
  return canonicalRedirect(context.request) ?? context.next()
}
