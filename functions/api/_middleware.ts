// Security middleware for all /api/* routes
// Runs before every API function on Cloudflare Pages

// Production origins only — capacitor:// is required for native Android/iOS app
const ALLOWED_ORIGINS = [
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

export const onRequest: PagesFunction = async (context) => {
  const { request } = context
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const origin = request.headers.get('origin') || ''
  const isAllowedOrigin = !origin || ALLOWED_ORIGINS.some((a) => origin.startsWith(a))

  // Handle CORS preflight (OPTIONS)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': isAllowedOrigin ? (origin || '*') : '',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, x-google-token, anthropic-version, anthropic-beta',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  // Rate limiting
  if (!checkRateLimit(ip)) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  // CSRF: check Origin on non-GET requests
  if (request.method !== 'GET' && !isAllowedOrigin) {
    return Response.json({ error: 'Forbidden — invalid origin' }, { status: 403 })
  }

  // Execute the actual function
  const response = await context.next()

  // Add security + CORS headers to all responses
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (isAllowedOrigin && origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, x-google-token, anthropic-version, anthropic-beta')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
