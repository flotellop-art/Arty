import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withPage } from '../_lib/browser'

interface PriceResult {
  source: string
  product: string
  price: string
  url: string
}

const SUPPLIERS = [
  {
    name: 'Point P',
    searchUrl: (q: string) => `https://www.pointp.fr/recherche?q=${encodeURIComponent(q)}`,
    selectors: {
      product: '.product-card__title, .product-name, h2.title',
      price: '.product-card__price, .price, .product-price',
    },
  },
  {
    name: 'Gedimat',
    searchUrl: (q: string) => `https://www.gedimat.fr/recherche?q=${encodeURIComponent(q)}`,
    selectors: {
      product: '.product-title, .product-name, h2 a',
      price: '.product-price, .price, .current-price',
    },
  },
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { query } = req.body as { query?: string }

  if (!query) {
    return res.status(400).json({ error: 'Missing search query' })
  }

  try {
    const results: PriceResult[] = []

    for (const supplier of SUPPLIERS) {
      try {
        const supplierResults = await withPage(
          async (page) => {
            const found: PriceResult[] = []

            await page.goto(supplier.searchUrl(query), {
              waitUntil: 'domcontentloaded',
              timeout: 15000,
            })

            // Wait a moment for content
            await page.waitForTimeout(2000)

            // Check for CAPTCHA
            const captcha = await page
              .locator('iframe[src*="captcha"], .captcha, #captcha, [class*="recaptcha"]')
              .isVisible({ timeout: 1000 })
              .catch(() => false)

            if (captcha) {
              found.push({
                source: supplier.name,
                product: query,
                price: 'CAPTCHA détecté — vérification manuelle requise',
                url: supplier.searchUrl(query),
              })
              return found
            }

            // Extract product results
            const products = page.locator(supplier.selectors.product)
            const prices = page.locator(supplier.selectors.price)

            const productCount = await products.count()
            const priceCount = await prices.count()
            const count = Math.min(productCount, priceCount, 3)

            for (let i = 0; i < count; i++) {
              const productText = await products.nth(i).textContent().catch(() => '')
              const priceText = await prices.nth(i).textContent().catch(() => '')

              if (productText && priceText) {
                found.push({
                  source: supplier.name,
                  product: productText.trim().slice(0, 100),
                  price: priceText.trim(),
                  url: supplier.searchUrl(query),
                })
              }
            }

            if (found.length === 0) {
              found.push({
                source: supplier.name,
                product: query,
                price: 'Aucun résultat trouvé',
                url: supplier.searchUrl(query),
              })
            }

            return found
          },
          { timeout: 20000 }
        )

        results.push(...supplierResults)
      } catch {
        results.push({
          source: supplier.name,
          product: query,
          price: 'Erreur de connexion au site',
          url: supplier.searchUrl(query),
        })
      }
    }

    return res.status(200).json({ query, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    return res.status(500).json({ error: message })
  }
}
