import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withPage, takeScreenshot as takeScreenshotUtil } from '../_lib/browser'

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

  const { type } = req.body as { type?: string }

  switch (type) {
    case 'screenshot':
      return handleScreenshot(req, res)
    case 'search-price':
      return handleSearchPrice(req, res)
    case 'fill-form':
      return handleFillForm(req, res)
    default:
      return res.status(400).json({ error: `Unknown type: ${type}. Use: screenshot, search-price, fill-form` })
  }
}

// --- Screenshot ---
async function handleScreenshot(req: VercelRequest, res: VercelResponse) {
  const { url } = req.body as { url?: string }
  if (!url) return res.status(400).json({ error: 'Missing url' })

  try {
    const screenshot = await takeScreenshotUtil(url)
    return res.status(200).json({ success: true, url, screenshot })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Screenshot failed' })
  }
}

// --- Search Price ---
async function handleSearchPrice(req: VercelRequest, res: VercelResponse) {
  const { query } = req.body as { query?: string }
  if (!query) return res.status(400).json({ error: 'Missing query' })

  try {
    const results: PriceResult[] = []

    for (const supplier of SUPPLIERS) {
      try {
        const supplierResults = await withPage(async (page) => {
          const found: PriceResult[] = []
          await page.goto(supplier.searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 15000 })
          await page.waitForTimeout(2000)

          const captcha = await page.locator('iframe[src*="captcha"], .captcha, #captcha, [class*="recaptcha"]')
            .isVisible({ timeout: 1000 }).catch(() => false)
          if (captcha) {
            found.push({ source: supplier.name, product: query, price: 'CAPTCHA détecté', url: supplier.searchUrl(query) })
            return found
          }

          const products = page.locator(supplier.selectors.product)
          const prices = page.locator(supplier.selectors.price)
          const count = Math.min(await products.count(), await prices.count(), 3)

          for (let i = 0; i < count; i++) {
            const productText = await products.nth(i).textContent().catch(() => '')
            const priceText = await prices.nth(i).textContent().catch(() => '')
            if (productText && priceText) {
              found.push({ source: supplier.name, product: productText.trim().slice(0, 100), price: priceText.trim(), url: supplier.searchUrl(query) })
            }
          }

          if (found.length === 0) {
            found.push({ source: supplier.name, product: query, price: 'Aucun résultat', url: supplier.searchUrl(query) })
          }
          return found
        }, { timeout: 20000 })
        results.push(...supplierResults)
      } catch {
        results.push({ source: supplier.name, product: query, price: 'Erreur connexion', url: supplier.searchUrl(query) })
      }
    }

    return res.status(200).json({ query, results })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' })
  }
}

// --- Fill Form ---
async function handleFillForm(req: VercelRequest, res: VercelResponse) {
  const { url, fields, submit } = req.body as {
    url?: string
    fields?: Array<{ selector: string; value: string; type?: string }>
    submit?: boolean
  }

  if (!url || !fields || fields.length === 0) {
    return res.status(400).json({ error: 'Missing url or fields' })
  }

  try {
    const result = await withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })

      const captcha = await page.locator('iframe[src*="captcha"], .captcha, #captcha, [class*="recaptcha"]')
        .isVisible({ timeout: 1000 }).catch(() => false)
      if (captcha) {
        return { success: false, error: 'CAPTCHA détecté', url }
      }

      const filledFields: string[] = []

      for (const field of fields) {
        try {
          const el = page.locator(field.selector)
          const visible = await el.isVisible({ timeout: 3000 }).catch(() => false)
          if (!visible) { filledFields.push(`⚠️ ${field.selector}: non trouvé`); continue }

          switch (field.type || 'text') {
            case 'text': await el.fill(field.value); break
            case 'select': await el.selectOption(field.value); break
            case 'checkbox': field.value === 'true' ? await el.check() : await el.uncheck(); break
            case 'radio': await el.check(); break
            case 'click': await el.click(); break
          }
          filledFields.push(`✅ ${field.selector}: rempli`)
        } catch {
          filledFields.push(`❌ ${field.selector}: erreur`)
        }
      }

      if (submit) {
        const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first()
        if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await submitBtn.click()
          await page.waitForTimeout(2000)
        }
      }

      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      return {
        success: true, url, fields: filledFields, submitted: submit || false,
        screenshot: `data:image/png;base64,${screenshot.toString('base64')}`,
      }
    })

    return res.status(200).json(result)
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Form fill failed' })
  }
}
