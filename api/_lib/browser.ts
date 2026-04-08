import chromium from '@sparticuz/chromium'
import { chromium as playwright } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'

let browserInstance: Browser | null = null

export async function launchBrowser(): Promise<Browser> {
  if (browserInstance?.isConnected()) {
    return browserInstance
  }

  const executablePath = await chromium.executablePath()

  browserInstance = await playwright.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  })

  return browserInstance
}

export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  options?: { timeout?: number }
): Promise<T> {
  const browser = await launchBrowser()
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  })

  const page = await context.newPage()
  page.setDefaultTimeout(options?.timeout ?? 25000)

  try {
    const result = await fn(page)
    return result
  } finally {
    await context.close().catch(() => {})
  }
}

export async function takeScreenshot(url: string): Promise<string> {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
    const buffer = await page.screenshot({ type: 'png', fullPage: false })
    return `data:image/png;base64,${buffer.toString('base64')}`
  })
}
