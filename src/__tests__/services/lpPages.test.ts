// Garde-fous statiques des landing pages pubs Meta (public/lp/*).
// Ces pages vivent HORS du bundle (pas de typecheck, pas de React) : les
// invariants critiques sont donc verrouillés ici, côté CI :
//   - parité du littéral 'arty-acquisition' entre lp.js et acquisition.ts ;
//   - aucun <script> inline (la CSP script-src 'self' le BLOQUERAIT en silence,
//     exactement le bug SW découvert le 15 juillet 2026) ;
//   - noindex (pages ad-only), CTA → /?start=1 (message match), lien privacy ;
//   - discipline copy : jamais « illimité ».
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACQUISITION_KEY, ACQUISITION_FIELDS } from '../../services/acquisition'

const LP_DIR = join(__dirname, '../../../public/lp')
const variants = readdirSync(LP_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
const lpJs = readFileSync(join(LP_DIR, 'lp.js'), 'utf8')

describe('public/lp — structure', () => {
  it('les 4 angles attendus existent', () => {
    expect(variants.sort()).toEqual(['agenda', 'confiance', 'essai', 'prix'])
  })
})

describe('public/lp/lp.js — parité avec la SPA', () => {
  it(`écrit sous le littéral '${ACQUISITION_KEY}' (clé lue par acquisition.ts)`, () => {
    expect(lpJs).toContain(`'${ACQUISITION_KEY}'`)
  })

  it("force la locale FR sous le littéral 'arty-locale' (clé lue par i18n/index.ts)", () => {
    expect(lpJs).toContain("'arty-locale'")
  })

  it('ne forwarde que des champs de l\'allowlist acquisition.ts', () => {
    const match = lpJs.match(/var FIELDS = \[([^\]]+)\]/)
    expect(match).not.toBeNull()
    const fields = match![1].split(',').map((s) => s.trim().replace(/'/g, ''))
    for (const field of fields) {
      expect(ACQUISITION_FIELDS as readonly string[]).toContain(field)
    }
  })
})

describe.each(variants)('public/lp/%s/index.html', (variant) => {
  const html = readFileSync(join(LP_DIR, variant, 'index.html'), 'utf8')

  it('est noindex (page ad-only)', () => {
    expect(html).toMatch(/<meta name="robots" content="noindex"/)
  })

  it("n'a AUCUN <script> inline (CSP script-src 'self' le bloquerait) et référence /lp/lp.js", () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    for (const tag of scripts) {
      expect(tag, `script inline interdit: ${tag}`).toMatch(/src=/)
    }
    expect(html).toContain('src="/lp/lp.js"')
  })

  it('a un CTA data-cta vers /?start=1 avec lp + utm_campaign = angle', () => {
    expect(html).toContain(`data-cta href="/?start=1&amp;lp=${variant}&amp;utm_source=meta`)
    expect(html).toContain(`utm_campaign=${variant}`)
  })

  it('a le lien privacy (exigence landing page Meta) et le data-lp', () => {
    expect(html).toContain('href="/privacy/"')
    expect(html).toContain(`data-lp="${variant}"`)
  })

  it('ne promet jamais « illimité » et ne désactive pas le zoom (a11y)', () => {
    expect(html).not.toMatch(/illimit/i)
    expect(html).not.toMatch(/user-scalable=no/)
  })
})
