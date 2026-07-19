// Security middleware for all /api/* routes
// Runs before every API function on Cloudflare Pages

// Production origins only — capacitor:// is required for native Android/iOS app
// Exporté pour le test de parité avec PRODUCTION_HOSTS (emailTrial.ts) : les
// deux listes doivent rester synchronisées sur les hosts prod HTTPS, sinon un
// nouveau domaine prod serait fail-open sur le gate Turnstile (C2/F-10).
export const ALLOWED_ORIGINS = [
  'https://tryarty.com',        // Nouveau domaine prod (launch Product Hunt)
  'https://www.tryarty.com',    // Variante www
  'https://appfacade.pages.dev',
  'https://arty.pages.dev',
  'https://app.arty.fr',
  'capacitor://localhost',   // Capacitor native app (Android/iOS)
  'https://localhost',       // Capacitor HTTPS on device
]

// Simple in-memory rate limiter (per-isolate, resets on new isolate)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 60
const RATE_WINDOW = 60_000

export const WORKSPACE_ADDON_POST_PATHS = new Set([
  '/api/workspace-addon/phase0/home',
  '/api/workspace-addon/phase0/context',
  '/api/workspace-addon/phase0/read',
  '/api/workspace-addon/phase0/create-draft',
])

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT
}

// Origin autorisé = liste prod en égalité STRICTE, OU un sous-domaine de
// preview du projet Cloudflare Pages (`*.appfacade.pages.dev`). Ces previews
// sont owner-only : seul le propriétaire du projet peut y déployer, donc aucun
// attaquant externe ne peut héberger une page sur ce host pour forger un POST
// cross-origin. On parse l'hostname via `new URL` (jamais de regex sur la
// string brute — évite les bypass userinfo `@`, backslash, suffixe `.evil.com`)
// et on exige le POINT de tête + https (sinon `xappfacade.pages.dev` passerait).
export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    const u = new URL(origin)
    return u.protocol === 'https:' && u.hostname.endsWith('.appfacade.pages.dev')
  } catch {
    return false
  }
}

export const onRequest: PagesFunction = async (context) => {
  const { request } = context
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const originHeader = request.headers.get('origin')
  const origin = originHeader ?? ''
  const hasSuppliedOrigin = originHeader !== null
  const url = new URL(request.url)
  // Phase 0 Workspace Add-on: Google/Apps Script call these handlers
  // server-to-server, without an Origin header. Keep this exception narrowly
  // scoped to POST requests under the exact `/api/workspace-addon/` prefix;
  // the handler still has to perform its own OIDC/runtime authentication.
  const isWorkspaceAddonNamespace = url.pathname.startsWith('/api/workspace-addon/')
  const isWorkspaceAddonPath = WORKSPACE_ADDON_POST_PATHS.has(url.pathname)
  const isWorkspaceAddonPost = request.method === 'POST' && isWorkspaceAddonPath
  // MED (audit étape 2) — égalité stricte au lieu de startsWith. Évite
  // qu'un Origin comme `https://tryarty.com:8080` ou `https://tryarty.com.evil`
  // matche par préfixe. + previews owner-only `*.appfacade.pages.dev`.
  const hasValidOrigin = isAllowedOrigin(origin)

  // Workspace Add-on endpoints are non-browser routes. Reject every supplied
  // Origin (including an otherwise allowed one) before CORS headers can be
  // added to the response.
  if (isWorkspaceAddonNamespace && (!isWorkspaceAddonPost || hasSuppliedOrigin)) {
    return Response.json({ error: 'Forbidden — invalid origin' }, { status: 403 })
  }

  // Handle CORS preflight (OPTIONS)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': hasValidOrigin ? origin : '',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-openai-key, x-google-token, x-arty-vision, x-arty-trial-token, anthropic-version, anthropic-beta',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  // Rate limiting
  // Google can fan many add-on calls through a shared egress IP. The exact
  // allowlisted add-on routes enforce their own post-OIDC limit by user `sub`;
  // applying this pre-auth IP bucket would let one tenant starve another.
  if (!isWorkspaceAddonPost && !checkRateLimit(ip)) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  // CSRF: non-GET requests must carry a whitelisted Origin header.
  // A missing Origin is rejected — browsers always send it on cross-origin
  // fetches, and the native Capacitor app sends `capacitor://localhost` or
  // `https://localhost` (both whitelisted above).
  // Exception : les webhooks server-to-server (ex: Lemon Squeezy) n'ont pas
  // d'Origin et s'authentifient via signature HMAC dans le handler lui-même.
  const isWebhook = url.pathname.startsWith('/api/webhook/')
  if (request.method !== 'GET' && !hasValidOrigin && !isWebhook && !isWorkspaceAddonPost) {
    return Response.json({ error: 'Forbidden — invalid origin' }, { status: 403 })
  }

  // Execute the actual function
  const response = await context.next()

  // Add security + CORS headers to all responses
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (hasValidOrigin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-openai-key, x-google-token, x-arty-vision, anthropic-version, anthropic-beta')
    // Expose les headers custom que le client lit côté navigateur (sinon
    // CORS les masque). `x-trial-remaining` est renvoyé par les proxys IA
    // pour mettre à jour le compteur d'essai côté front à chaque message.
    headers.set('Access-Control-Expose-Headers', 'x-trial-remaining')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
