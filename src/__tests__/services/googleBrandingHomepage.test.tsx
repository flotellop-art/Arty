import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { PublicLandingFallback } from '../../components/shared/PublicLandingFallback'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

describe('page d’accueil publique pour la validation Google OAuth', () => {
  it('décrit Arty et Google Calendar dans le body même sans JavaScript', () => {
    const document = new JSDOM(html).window.document
    const root = document.querySelector<HTMLElement>('#root')
    const copy = root?.textContent?.replace(/\s+/g, ' ') ?? ''

    expect(root).not.toBeNull()
    expect(root?.querySelector('h1')?.textContent?.trim()).toBe('Arty')
    expect(copy).toMatch(/Arty est un assistant IA personnel/i)
    expect(copy).toMatch(/agenda Google/i)
    expect(copy).toMatch(/connexion Google/i)
    expect(copy).toMatch(/crée.*modifie.*supprime/i)
    expect(copy).toMatch(/brief proactif.*désactivable/i)
    expect(copy).toMatch(/Anthropic/i)
    expect(root?.querySelector('a[href="/privacy/"]')).not.toBeNull()
    expect(root?.querySelector('a[href="/terms/"]')).not.toBeNull()
    expect(root?.querySelector('a[href="/legal-notice/"]')).not.toBeNull()
    expect(root?.hasAttribute('hidden')).toBe(false)
    expect(root?.querySelector('[hidden], .sr-only, [style*="display: none"]')).toBeNull()
  })

  it('ne publie aucune configuration OAuth ou donnée secrète dans le fallback', () => {
    const document = new JSDOM(html).window.document
    const fallback = document.querySelector('#root')?.innerHTML ?? ''

    expect(fallback).not.toMatch(/client[_-]?id|client[_-]?secret|redirect_uri|auth\/callback/i)
    expect(fallback).not.toMatch(/token|verifier|code_challenge/i)
  })

  it('conserve le nom, la finalité et les liens légaux pendant le chargement React', () => {
    render(<PublicLandingFallback />)

    expect(screen.getByRole('heading', { level: 1, name: 'Arty' })).toBeInTheDocument()
    expect(screen.getByText(/assistant IA personnel/i)).toBeVisible()
    expect(screen.getByText(/brief proactif/i)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Politique de confidentialité' })).toHaveAttribute(
      'href',
      '/privacy/',
    )
    expect(screen.getByRole('link', { name: "Conditions d'utilisation" })).toHaveAttribute(
      'href',
      '/terms/',
    )
  })
})
