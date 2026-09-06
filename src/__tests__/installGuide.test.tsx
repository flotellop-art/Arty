import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PublicLandingFallback } from '../components/shared/PublicLandingFallback'

const read = (path: string) => readFileSync(path, 'utf8')

describe('public installation documents', () => {
  it.each([['fr', 'public/install/index.html', '/install/'], ['en', 'public/install/en/index.html', '/install/en/']])('ships a standalone %s guide', (language, path, canonical) => {
    const html = read(path)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.documentElement.lang).toBe(language)
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
    expect(doc.querySelectorAll('script, form, iframe, object, embed, link[rel="manifest"], link[rel="modulepreload"], link[rel="preload"], link[rel="preconnect"]')).toHaveLength(0)
    expect(html).not.toMatch(/localStorage|sessionStorage|indexedDB|serviceWorker|sw-register|\/src\/|on(?:click|load|error)=|javascript:/i)
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://tryarty.com' + canonical)
    expect(doc.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('/install/install.css')
    expect(doc.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1)
    expect(doc.querySelectorAll('.card')).toHaveLength(4)
    expect(doc.querySelectorAll('details')).toHaveLength(4)
    expect(doc.querySelectorAll('a[href="mailto:support@tryarty.com"]')).toHaveLength(2)
    expect(html).not.toMatch(/data-cfemail|email-decode|cloudflareinsights/i)
    expect(html).toContain('Guide policy v55')
    expect(doc.querySelector('.notice')?.compareDocumentPosition(doc.querySelector('.grid')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    for (const link of doc.querySelectorAll<HTMLAnchorElement>('a')) {
      expect(link.textContent?.trim()).not.toBe('')
      expect(link.hasAttribute('target')).toBe(false)
      const href = link.getAttribute('href')!
      if (href.startsWith('#')) expect(doc.getElementById(href.slice(1))).not.toBeNull()
      else if (href.startsWith('http')) expect(['tryarty.com', 'support.google.com', 'support.apple.com', 'firebase.google.com']).toContain(new URL(href).hostname)
    }
    for (const link of doc.querySelectorAll('.button')) expect(link.getAttribute('href')).toBe('https://tryarty.com/')
    expect(doc.querySelector('a[href="https://tryarty.com/login"]')).not.toBeNull()
    for (const id of ['android', 'apple', 'desktop', 'beta', 'help']) expect(doc.getElementById(id)).not.toBeNull()
    expect(html).not.toMatch(/play\.google\.com|href="[^"]*\.apk/)
  })

  it('keeps FR and EN local-data, beta, offline and native-only warnings', () => {
    const fr = read('public/install/index.html')
    const en = read('public/install/en/index.html')
    expect(fr).toContain('ne transfère pas automatiquement')
    expect(en).toContain('does not automatically transfer')
    expect(fr).toContain('La restauration et la synchronisation entre appareils ne sont pas disponibles')
    expect(en).toContain('Restore and cross-device sync are not available')
    expect(fr).toContain('testeurs invités')
    expect(en).toContain('invited testers')
    expect(fr).toContain('App Tester est facultative')
    expect(en).toContain('App Tester application is optional')
    expect(fr).toContain('IMAP est réservée à Android natif')
    expect(en).toContain('IMAP mail connections are native Android only')
    expect(fr).toContain('nécessitent internet')
    expect(en).toContain('need internet access')
  })

  it('uses only local CSS and system fonts with visible focus and flexible layout', () => {
    const css = read('public/install/install.css')
    expect(css).not.toMatch(/@import|url\(|@font-face/i)
    expect(css).toContain('system-ui')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('grid-template-columns: 1fr')
  })

  it('offers the guide from the public lazy-loading fallback without an auth action', () => {
    render(<PublicLandingFallback />)
    expect(screen.getByRole('link', { name: "Guide d'installation" })).toHaveAttribute('href', '/install/')
  })
})
