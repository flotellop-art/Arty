// Landing marketing (item 16 roadmap v2) — 3 familles de garde-fous :
// 1. Câblage des CTA : tous les « Essayer/Commencer » mènent à l'onboarding
//    (onStart), les « Se connecter » au login (onLogin).
// 2. Parité i18n : le sous-arbre landing.* doit avoir EXACTEMENT les mêmes
//    clés en fr et en (même pattern que routeReason.i18n.test.ts).
// 3. Discipline copy (anti-objectifs audit concurrentiel 12 juin 2026) :
//    jamais « illimité »/« unlimited » sur la landing, et le pricing repris
//    mot pour mot des clés upgrade.* (source de vérité) pour ne pas dériver.
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

import { LandingScreen } from '../../screens/landing'
import fr from '../../i18n/locales/fr.json'
import en from '../../i18n/locales/en.json'

describe('LandingScreen — câblage des CTA', () => {
  it('les CTA « essayer » (header, hero, cartes pricing, CTA final) appellent onStart', () => {
    const onStart = vi.fn()
    render(<LandingScreen onStart={onStart} onLogin={() => {}} />)
    const ctas = [
      ...screen.getAllByText('landing.nav.cta'),
      ...screen.getAllByText('landing.hero.cta'),
      ...screen.getAllByText('landing.pricing.cardCta'),
    ]
    // header + hero + CTA final + 3 cartes pricing
    expect(ctas.length).toBe(6)
    ctas.forEach((el) => fireEvent.click(el))
    expect(onStart).toHaveBeenCalledTimes(6)
  })

  it('les liens « se connecter » (header + footer) appellent onLogin', () => {
    const onLogin = vi.fn()
    render(<LandingScreen onStart={() => {}} onLogin={onLogin} />)
    fireEvent.click(screen.getByText('landing.nav.login'))
    fireEvent.click(screen.getByText('landing.footer.login'))
    expect(onLogin).toHaveBeenCalledTimes(2)
  })

  it('rend les 7 questions de la FAQ en <details> (pas de JS requis)', () => {
    const { container } = render(<LandingScreen onStart={() => {}} onLogin={() => {}} />)
    expect(container.querySelectorAll('details').length).toBe(7)
  })
})

// ─── Garde-fous i18n / copy ─────────────────────────────────────────────

type Tree = Record<string, unknown>
const frLanding = (fr as unknown as { landing: Tree }).landing
const enLanding = (en as unknown as { landing: Tree }).landing

function collectKeys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return typeof v === 'object' && v !== null ? collectKeys(v as Tree, path) : [path]
  })
}

describe('parité i18n landing.*', () => {
  it('fr et en ont exactement les mêmes clés', () => {
    expect(collectKeys(frLanding).sort()).toEqual(collectKeys(enLanding).sort())
  })

  it('aucune valeur vide', () => {
    for (const tree of [frLanding, enLanding]) {
      for (const key of collectKeys(tree)) {
        const value = key.split('.').reduce<unknown>((acc, part) => (acc as Tree)[part], tree)
        expect(String(value).trim(), `valeur vide: landing.${key}`).not.toBe('')
      }
    }
  })
})

describe('discipline copy landing (anti-objectifs)', () => {
  it('ne promet JAMAIS « illimité »/« unlimited » — formulation validée : « sans plafond mensuel »', () => {
    expect(JSON.stringify(frLanding)).not.toMatch(/illimit/i)
    expect(JSON.stringify(enLanding)).not.toMatch(/unlimited/i)
  })

  it('le pricing reprend mot pour mot les clés upgrade.* (source de vérité, pas de dérive)', () => {
    const frUpgrade = (fr as unknown as { upgrade: Record<string, string> }).upgrade
    const enUpgrade = (en as unknown as { upgrade: Record<string, string> }).upgrade
    const frPricing = frLanding.pricing as Record<string, string>
    const enPricing = enLanding.pricing as Record<string, string>
    expect(frPricing.subDesc).toBe(frUpgrade.subscriptionDescription)
    expect(enPricing.subDesc).toBe(enUpgrade.subscriptionDescription)
    expect(frPricing.transparency).toBe(frUpgrade.transparency)
    expect(enPricing.transparency).toBe(enUpgrade.transparency)
    expect(frPricing.subReassurance).toBe(frUpgrade.subscriptionReassurance)
    expect(enPricing.subReassurance).toBe(enUpgrade.subscriptionReassurance)
  })
})
