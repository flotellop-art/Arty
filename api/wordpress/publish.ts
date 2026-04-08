import type { VercelRequest, VercelResponse } from '@vercel/node'
import { withPage } from '../_lib/browser'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { title, content, category, tags, status } = req.body as {
    title?: string
    content?: string
    category?: string
    tags?: string[]
    status?: 'publish' | 'draft'
  }

  if (!title || !content) {
    return res.status(400).json({ error: 'Missing title or content' })
  }

  const wpUrl = process.env.WP_URL
  const wpUser = process.env.WP_USERNAME
  const wpPass = process.env.WP_PASSWORD

  if (!wpUrl || !wpUser || !wpPass) {
    return res.status(500).json({ error: 'WordPress credentials not configured' })
  }

  try {
    const result = await withPage(async (page) => {
      // Login to WordPress
      await page.goto(`${wpUrl}/wp-login.php`, { waitUntil: 'networkidle', timeout: 20000 })
      await page.fill('#user_login', wpUser)
      await page.fill('#user_pass', wpPass)
      await page.click('#wp-submit')
      await page.waitForURL('**/wp-admin/**', { timeout: 15000 })

      // Navigate to new post (classic editor URL)
      await page.goto(`${wpUrl}/wp-admin/post-new.php`, { waitUntil: 'networkidle', timeout: 15000 })

      // Fill title
      const titleInput = page.locator('#title')
      if (await titleInput.isVisible()) {
        await titleInput.fill(title)
      }

      // Fill content — try classic editor first, then Gutenberg
      const classicEditor = page.locator('#content')
      if (await classicEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
        await classicEditor.fill(content)
      } else {
        // Gutenberg block editor
        const gutenbergEditor = page.locator('[contenteditable="true"]').first()
        if (await gutenbergEditor.isVisible({ timeout: 3000 }).catch(() => false)) {
          await gutenbergEditor.click()
          await page.keyboard.type(content)
        }
      }

      // Set category if specified
      if (category) {
        const categoryCheckbox = page.locator(`label:has-text("${category}") input[type="checkbox"]`)
        if (await categoryCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
          await categoryCheckbox.check()
        }
      }

      // Set tags if specified
      if (tags && tags.length > 0) {
        const tagInput = page.locator('#new-tag-post_tag')
        if (await tagInput.isVisible({ timeout: 2000 }).catch(() => false)) {
          await tagInput.fill(tags.join(', '))
          await page.locator('.tagadd').click()
        }
      }

      // Publish or save draft
      if (status === 'publish') {
        const publishBtn = page.locator('#publish')
        await publishBtn.click()
        await page.waitForSelector('#message', { timeout: 10000 }).catch(() => {})
      } else {
        const draftBtn = page.locator('#save-post')
        if (await draftBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await draftBtn.click()
          await page.waitForSelector('#message', { timeout: 10000 }).catch(() => {})
        }
      }

      // Get the post URL
      const permalink = page.locator('#sample-permalink a')
      let postUrl = ''
      if (await permalink.isVisible({ timeout: 3000 }).catch(() => false)) {
        postUrl = await permalink.getAttribute('href') || ''
      }

      return {
        success: true,
        title,
        status: status || 'draft',
        url: postUrl,
      }
    })

    return res.status(200).json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'WordPress publish failed'
    return res.status(500).json({ error: message })
  }
}
