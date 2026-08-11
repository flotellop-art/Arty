const CANONICAL_ORIGIN = 'https://tryarty.com'

// Public hosts that previously served the production application. Cloudflare
// preview deployments remain available because their host is a subdomain of
// appfacade.pages.dev, not the exact project hostname below.
export const LEGACY_PUBLIC_HOSTS = new Set([
  'appfacade.pages.dev',
  'www.tryarty.com',
])

// Les fournisseurs peuvent avoir un webhook en vol au moment du déploiement.
// Ces deux handlers vérifient leur signature HMAC; on les garde joignables sur
// l'hostname technique jusqu'au smoke des URLs configurées chez les providers.
export const LEGACY_WEBHOOK_PATHS = new Set([
  '/api/webhook/creem',
  '/api/webhook/lemonsqueezy',
])

export function canonicalRedirect(request: Request): Response | null {
  const source = new URL(request.url)
  if (!LEGACY_PUBLIC_HOSTS.has(source.hostname.toLowerCase())) return null
  const normalizedPath = source.pathname.length > 1
    ? source.pathname.replace(/\/+$/, '')
    : source.pathname

  if (
    source.hostname.toLowerCase() === 'appfacade.pages.dev'
    && LEGACY_WEBHOOK_PATHS.has(normalizedPath)
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
