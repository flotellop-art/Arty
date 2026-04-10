import type { VercelRequest, VercelResponse } from '@vercel/node'

type ActionHandler = (token: string, req: VercelRequest, res: VercelResponse) => Promise<VercelResponse | void>

export function createApiHandler(
  handlers: Record<string, ActionHandler>,
  options?: { requireAuth?: boolean }
) {
  return async (req: VercelRequest, res: VercelResponse) => {
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
