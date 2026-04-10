import type { VercelRequest, VercelResponse } from '@vercel/node'

type ActionHandler = (token: string, req: VercelRequest, res: VercelResponse) => Promise<VercelResponse | void>

// Allowed origins for CSRF protection
const ALLOWED_ORIGINS = [
  'https://arty.vercel.app',
  'https://app.arty.fr',
  'http://localhost:5173',
  'http://localhost:3000',
  'capacitor://localhost',   // Capacitor iOS
  'http://localhost',        // Capacitor Android
]

function checkOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin || req.headers.referer || ''
  // Allow requests with no origin (server-to-server, Capacitor native)
  if (!origin) return true
  return ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed))
}

// Simple in-memory rate limiter (resets on cold start)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 60    // requests per window
const RATE_WINDOW = 60000 // 1 minute

function checkRateLimit(req: VercelRequest): boolean {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW })
    return true
  }

  entry.count++
  return entry.count <= RATE_LIMIT
}

export function createApiHandler(
  handlers: Record<string, ActionHandler>,
  options?: { requireAuth?: boolean }
) {
  return async (req: VercelRequest, res: VercelResponse) => {
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff')

    // CSRF: check Origin on POST/PUT/DELETE
    if (req.method !== 'GET' && !checkOrigin(req)) {
      return res.status(403).json({ error: 'Forbidden — invalid origin' })
    }

    // Rate limiting
    if (!checkRateLimit(req)) {
      return res.status(429).json({ error: 'Too many requests' })
    }

    const token = req.headers.authorization?.replace('Bearer ', '') || ''
    if (options?.requireAuth !== false && !token) {
      return res.status(401).json({ error: 'Missing access token' })
    }

    const { type } = (req.method === 'GET' ? req.query : req.body) as { type?: string }
    const handler = type ? handlers[type] : undefined
    if (!handler) {
      return res.status(400).json({ error: `Use type: ${Object.keys(handlers).join(', ')}` })
    }
    return handler(token, req, res)
  }
}
