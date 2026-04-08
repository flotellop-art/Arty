import type { VercelRequest, VercelResponse } from '@vercel/node'
import { takeScreenshot } from '../_lib/browser'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url } = req.body as { url?: string }

  if (!url) {
    return res.status(400).json({ error: 'Missing url' })
  }

  try {
    const screenshot = await takeScreenshot(url)
    return res.status(200).json({
      success: true,
      url,
      screenshot,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Screenshot failed'
    return res.status(500).json({ error: message })
  }
}
