// Security middleware for all /api/* routes
// Runs before every API function on Cloudflare Pages

const ALLOWED_ORIGINS = [
  'https://appfacade.pages.dev',
  'https://arty.pages.dev',
  'https://app.arty.fr',
  'http://localhost:5173',
  'http://localhost:3000',
  'capacitor://localhost',
  'http://localhost',
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

  // Rate limiting
  if (!checkRateLimit(ip)) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  // CSRF: check Origin on non-GET requests
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin') || ''
    if (origin && !ALLOWED_ORIGINS.some((a) => origin.startsWith(a))) {
      return Response.json({ error: 'Forbidden — invalid origin' }, { status: 403 })
    }
  }

  // Execute the actual function
  const response = await context.next()

  // Add security headers to all responses
  const headers = new Headers(response.headers)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
