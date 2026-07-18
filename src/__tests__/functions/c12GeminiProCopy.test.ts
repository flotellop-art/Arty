// C12 (CDC veille 2026-07) : le copy « 80 Gemini Pro » était structurellement
// mensonger — le bucket s'affichait (PlanBadge/ChatOptionsSheet) et se vendait
// (Upgrade, FAQ, landing prix) alors qu'AUCUN chemin de l'app ne peut le
// consommer depuis C1 (Auto ne route jamais vers un -pro, comparateur
// nettoyé). Garde anti-dérive (pattern F-1) : réintroduire le copy OU
// l'affichage du bucket sans un vrai chemin de consommation (GA Gemini
// 3.5 Pro) doit faire rougir la CI. Le cap serveur, lui, RESTE enforcé
// (défense en profondeur — voir premiumModelClassification.test.ts).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('C12 — plus aucun copy « Gemini Pro » vendu sans chemin de consommation', () => {
  it('locales fr/en : aucune promesse marketing « Gemini Pro »', () => {
    // « Gemini » seul reste légitime (les abonnés ont bien Gemini Flash via
    // Auto/recherche) — c'est le suffixe « Pro » qui promettait un modèle
    // inaccessible.
    expect(read('src/i18n/locales/fr.json')).not.toContain('Gemini Pro')
    expect(read('src/i18n/locales/en.json')).not.toContain('Gemini Pro')
  })

  it('landing pages : aucune promesse « Gemini Pro » (prix, essai, agenda)', () => {
    for (const lp of ['prix', 'essai', 'agenda']) {
      expect(read(`public/lp/${lp}/index.html`)).not.toContain('Gemini Pro')
    }
  })

  it('subscription/status masque les buckets gemini-pro et unknown-model (mais checkPremiumCap les enforce toujours)', () => {
    const statusSrc = read('functions/api/subscription/status.ts')
    expect(statusSrc).toMatch(/hiddenBuckets = new Set\(\['gemini-pro', 'unknown-model'\]\)/)
    expect(statusSrc).toMatch(/hiddenBuckets\.has\(bucket\)/)
    // La source de vérité des caps garde les deux buckets : le filtre est un
    // masque d'AFFICHAGE, pas un retrait d'enforcement.
    const capsSrc = read('functions/api/_lib/checkPremiumCap.ts')
    expect(capsSrc).toMatch(/'gemini-pro': 80/)
    expect(capsSrc).toMatch(/'unknown-model': 80/)
  })
})
