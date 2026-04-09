import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { query } = req.body as { query?: string }
  if (!query) {
    return res.status(400).json({ error: 'Missing query' })
  }

  try {
    // Use DuckDuckGo HTML lite for search (no API key needed)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      return res.status(500).json({ error: 'Search failed' })
    }

    const html = await response.text()

    // Parse results from DuckDuckGo HTML
    const results: Array<{ title: string; url: string; snippet: string }> = []
    const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
      const url = decodeURIComponent((match[1] || '').replace(/.*uddg=/, '').replace(/&.*/, ''))
      const title = (match[2] || '').trim()
      const snippet = (match[3] || '').replace(/<[^>]*>/g, '').trim()

      if (title && url && !url.includes('duckduckgo.com')) {
        results.push({ title, url, snippet })
      }
    }

    // Fallback: simpler regex if above didn't work
    if (results.length === 0) {
      const simpleRegex = /<a[^>]+class="result__a"[^>]*>([^<]*)<\/a>/g
      let simpleMatch
      while ((simpleMatch = simpleRegex.exec(html)) !== null && results.length < 5) {
        results.push({
          title: (simpleMatch[1] || '').trim(),
          url: '',
          snippet: '',
        })
      }
    }

    return res.status(200).json({ query, results })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' })
  }
}
