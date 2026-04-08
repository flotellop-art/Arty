import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withPage } from '../_lib/browser'

interface FormField {
  selector: string
  value: string
  type?: 'text' | 'select' | 'checkbox' | 'radio' | 'click'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url, fields, submit } = req.body as {
    url?: string
    fields?: FormField[]
    submit?: boolean
  }

  if (!url || !fields || fields.length === 0) {
    return res.status(400).json({ error: 'Missing url or fields' })
  }

  try {
    const result = await withPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })

      // Check for CAPTCHA
      const captcha = await page
        .locator('iframe[src*="captcha"], .captcha, #captcha, [class*="recaptcha"]')
        .isVisible({ timeout: 1000 })
        .catch(() => false)

      if (captcha) {
        return {
          success: false,
          error: 'CAPTCHA détecté sur la page — remplissage automatique impossible',
          url,
        }
      }

      const filledFields: string[] = []

      for (const field of fields) {
        try {
          const el = page.locator(field.selector)
          const visible = await el.isVisible({ timeout: 3000 }).catch(() => false)

          if (!visible) {
            filledFields.push(`⚠️ ${field.selector}: champ non trouvé`)
            continue
          }

          switch (field.type || 'text') {
            case 'text':
              await el.fill(field.value)
              break
            case 'select':
              await el.selectOption(field.value)
              break
            case 'checkbox':
              if (field.value === 'true') await el.check()
              else await el.uncheck()
              break
            case 'radio':
              await el.check()
              break
            case 'click':
              await el.click()
              break
          }

          filledFields.push(`✅ ${field.selector}: rempli`)
        } catch {
          filledFields.push(`❌ ${field.selector}: erreur`)
        }
      }

      // Submit only if explicitly requested
      if (submit) {
        const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first()
        if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await submitBtn.click()
          await page.waitForTimeout(2000)
        }
      }

      // Take a screenshot of the result
      const screenshot = await page.screenshot({ type: 'png', fullPage: false })
      const screenshotBase64 = `data:image/png;base64,${screenshot.toString('base64')}`

      return {
        success: true,
        url,
        fields: filledFields,
        submitted: submit || false,
        screenshot: screenshotBase64,
      }
    })

    return res.status(200).json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Form fill failed'
    return res.status(500).json({ error: message })
  }
}
