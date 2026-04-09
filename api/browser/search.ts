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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    })

    if (!response.ok) {
      return res.status(500).json({ error: `Search failed with status ${response.status}` })
    }

    const html = await response.text()

    const results: Array<{ title: string; url: string; snippet: string }> = []

    // Strategy 1: Classic DuckDuckGo HTML lite format
    const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
      const rawUrl = match[1] || ''
      const url = decodeURIComponent(rawUrl.replace(/.*uddg=/, '').replace(/&.*/, ''))
      const title = (match[2] || '').replace(/<[^>]*>/g, '').trim()
      const snippet = (match[3] || '').replace(/<[^>]*>/g, '').trim()

      if (title && url && !url.includes('duckduckgo.com')) {
        results.push({ title, url, snippet })
      }
    }

    // Strategy 2: Separate link + snippet matching (if DDG changed layout)
    if (results.length === 0) {
      const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
      const snippetRegex = /<(?:a|td)[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>/g

      const links: Array<{ url: string; title: string }> = []
      let linkMatch
      while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 8) {
        const rawUrl = linkMatch[1] || ''
        const url = decodeURIComponent(rawUrl.replace(/.*uddg=/, '').replace(/&.*/, ''))
        const title = (linkMatch[2] || '').replace(/<[^>]*>/g, '').trim()
        if (title && !url.includes('duckduckgo.com')) {
          links.push({ url, title })
        }
      }

      const snippets: string[] = []
      let snippetMatch
      while ((snippetMatch = snippetRegex.exec(html)) !== null && snippets.length < 8) {
        snippets.push((snippetMatch[1] || '').replace(/<[^>]*>/g, '').trim())
      }

      for (let i = 0; i < links.length; i++) {
        results.push({
          title: links[i].title,
          url: links[i].url,
          snippet: snippets[i] || '',
        })
      }
    }

    // Strategy 3: Generic link extraction as last resort
    if (results.length === 0) {
      const genericRegex = /<a[^>]+href="(\/\/duckduckgo\.com\/l\/\?uddg=[^"]*)"[^>]*>([\s\S]*?)<\/a>/g
      let genericMatch
      while ((genericMatch = genericRegex.exec(html)) !== null && results.length < 5) {
        const rawUrl = genericMatch[1] || ''
        const url = decodeURIComponent(rawUrl.replace(/.*uddg=/, '').replace(/&.*/, ''))
        const title = (genericMatch[2] || '').replace(/<[^>]*>/g, '').trim()
        if (title && url) {
          results.push({ title, url, snippet: '' })
        }
      }
    }

    return res.status(200).json({ query, results, resultCount: results.length })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' })
  }
}
