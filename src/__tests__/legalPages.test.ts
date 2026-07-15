import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function publicFile(path: string): string {
  return readFileSync(resolve(root, 'public', path), 'utf8')
}

describe('public legal pages', () => {
  it.each([
    ['terms/index.html', 'Conditions d’utilisation et de vente'],
    ['terms/en/index.html', 'Terms of Use and Sale'],
    ['legal-notice/index.html', 'Mentions légales'],
    ['legal-notice/en/index.html', 'Legal notice'],
  ])('publishes %s with a specific title', (path, title) => {
    const html = publicFile(path)
    expect(html).toContain(`<title>${title} — Arty</title>`)
    expect(html).toContain('support@tryarty.com')
    expect(html).toContain('887 679 611')
  })

  it('keeps the privacy policy aligned with the registered business', () => {
    const french = publicFile('privacy/index.html')
    const english = publicFile('privacy/en/index.html')

    for (const html of [french, english]) {
      expect(html).toContain('POLLET FLORENT')
      expect(html).toContain('support@tryarty.com')
      expect(html).not.toContain('flotellop@gmail.com')
      expect(html).not.toContain('884 chemin de la Prairie')
    }
  })

  it.each(['agenda', 'confiance', 'essai', 'prix'])(
    'shows legal and branded-support links on the %s landing page',
    (landing) => {
      const html = publicFile(`lp/${landing}/index.html`)
      expect(html).toContain('href="/terms/"')
      expect(html).toContain('href="/legal-notice/"')
      expect(html).toContain('mailto:support@tryarty.com')
    },
  )
})
