// Tests d'applyClaimCorrections (fix « correction non appliquée », 11 juin
// 2026). Couvre le match exact historique, le fallback tolérant (markdown,
// typographie) et les garde-fous anti sur-remplacement. Premier test du
// service factChecker.
import { describe, it, expect } from 'vitest'
import { applyClaimCorrections, extractJsonObject } from '../../services/factChecker'
import type { FactCheckClaim } from '../../types'

function wrongClaim(originalText: string, correction: string): FactCheckClaim {
  return { claim: 'test', verdict: 'wrong', explanation: '', originalText, correction }
}

describe('applyClaimCorrections — match exact (comportement historique)', () => {
  it('remplace toutes les occurrences exactes et pose applied=true', () => {
    const c = wrongClaim('Opus 4.7', 'Opus 4.8')
    const { correctedContent, appliedCount } = applyClaimCorrections(
      'Titre : Opus 4.7. Le corps parle aussi de Opus 4.7.',
      [c]
    )
    expect(correctedContent).toBe('Titre : Opus 4.8. Le corps parle aussi de Opus 4.8.')
    expect(appliedCount).toBe(1)
    expect(c.applied).toBe(true)
  })

  it('passage introuvable → contenu intact, applied=false', () => {
    const c = wrongClaim('phrase totalement absente du contenu', 'peu importe')
    const { correctedContent, appliedCount } = applyClaimCorrections('La météo est belle.', [c])
    expect(correctedContent).toBe('La météo est belle.')
    expect(appliedCount).toBe(0)
    expect(c.applied).toBe(false)
  })
})

describe('applyClaimCorrections — fallback tolérant', () => {
  it('gras markdown dans la réponse, cité sans les ** par le checker', () => {
    const c = wrongClaim('Températures entre 13° et 20°', 'Températures entre 10° et 21°')
    const { correctedContent } = applyClaimCorrections(
      'Aujourd’hui : **Températures entre 13° et 20°**, vent faible.',
      [c]
    )
    expect(correctedContent).toBe('Aujourd’hui : **Températures entre 10° et 21°**, vent faible.')
    expect(c.applied).toBe(true)
  })

  it('apostrophe courbe dans la réponse vs droite citée', () => {
    const c = wrongClaim("90% aujourd'hui à Voiron", "20% aujourd'hui à Voiron")
    const { correctedContent } = applyClaimCorrections(
      'Pluie : 90% aujourd’hui à Voiron selon les sources.',
      [c]
    )
    expect(correctedContent).toContain('20%')
    expect(correctedContent).not.toContain('90%')
    expect(c.applied).toBe(true)
  })

  it('espace insécable dans la réponse vs espace simple cité', () => {
    const c = wrongClaim('vent 11-30 km/h', 'vent 17-44 km/h')
    const { correctedContent } = applyClaimCorrections(
      'Conditions : vent\u00A011-30\u00A0km/h cet après-midi.',
      [c]
    )
    expect(correctedContent).toContain('vent 17-44 km/h')
    expect(c.applied).toBe(true)
  })

  it('tiret demi-cadratin dans la réponse vs tiret simple cité', () => {
    const c = wrongClaim('entre 13-20 degrés', 'entre 10-21 degrés')
    const { correctedContent } = applyClaimCorrections('Il fera entre 13–20 degrés.', [c])
    expect(correctedContent).toBe('Il fera entre 10-21 degrés.')
    expect(c.applied).toBe(true)
  })

  it('garde-fou : passage court (< 10 chars) jamais fuzzy-matché', () => {
    // Apostrophe droite citée vs courbe dans la réponse → l'exact rate ;
    // le fuzzy est refusé car le passage fait moins de 10 caractères.
    const c = wrongClaim("l'été 20°", "l'été 25°")
    const { correctedContent } = applyClaimCorrections('Il fera l’été 20° ici.', [c])
    expect(correctedContent).toBe('Il fera l’été 20° ici.')
    expect(c.applied).toBe(false)
  })

  it('garde-fou : occurrence normalisée ambiguë (×2) → abandon', () => {
    // Les deux occurrences ont une apostrophe courbe (l'exact rate), le
    // fuzzy en trouve 2 → abandon plutôt que risquer le mauvais passage.
    const c = wrongClaim("risque d'orage pour demain", "risque d'orage pour vendredi")
    const { correctedContent } = applyClaimCorrections(
      'Le risque d’orage pour demain est fort. Je répète : risque d’orage pour demain.',
      [c]
    )
    expect(correctedContent).toContain('risque d’orage pour demain')
    expect(c.applied).toBe(false)
  })

  it('mix : un claim appliqué, un claim raté — flags et compteur distincts', () => {
    const ok = wrongClaim('vent 11-30 km/h', 'vent 17-44 km/h')
    const ko = wrongClaim('texte absent de la réponse', 'autre chose')
    const { appliedCount } = applyClaimCorrections(
      'Aujourd’hui : vent 11-30 km/h.',
      [ok, ko]
    )
    expect(appliedCount).toBe(1)
    expect(ok.applied).toBe(true)
    expect(ko.applied).toBe(false)
  })

  it('claims verified/uncertain jamais touchés ni flaggés', () => {
    const v: FactCheckClaim = { claim: 'ok', verdict: 'verified', explanation: '' }
    const { correctedContent, appliedCount } = applyClaimCorrections('Contenu.', [v])
    expect(correctedContent).toBe('Contenu.')
    expect(appliedCount).toBe(0)
    expect(v.applied).toBeUndefined()
  })
})

// Extraction JSON à accolades équilibrées (fiabilité, juillet 2026). L'ancien
// regex greedy /\{[\s\S]*\}/ capturait jusqu'à la DERNIÈRE accolade du texte :
// n'importe quel commentaire post-JSON contenant « } » produisait un « JSON
// malformé » et faisait échouer toute la vérification.
describe('extractJsonObject — extraction équilibrée', () => {
  it('objet JSON nu', () => {
    expect(extractJsonObject('{"a": 1}')).toBe('{"a": 1}')
  })

  it('JSON wrappé dans des backticks + prose avant', () => {
    const text = 'Voici mon analyse :\n```json\n{"claims": []}\n```'
    expect(extractJsonObject(text)).toBe('{"claims": []}')
  })

  it('prose APRÈS le JSON contenant une accolade → objet exact quand même', () => {
    const text = '{"claims": [{"claim": "x"}]}\nNote : le format {clé} est respecté.'
    expect(extractJsonObject(text)).toBe('{"claims": [{"claim": "x"}]}')
  })

  it('accolades DANS une string JSON (explication citant du code) ignorées', () => {
    const json = '{"explanation": "le pattern {a: 1} est faux", "v": "wrong"}'
    expect(extractJsonObject('bla ' + json)).toBe(json)
  })

  it('guillemets échappés dans une string ne cassent pas le tracking', () => {
    const json = '{"claim": "il a dit \\"non\\" hier"}'
    expect(extractJsonObject(json)).toBe(json)
  })

  it('JSON tronqué (max_tokens atteint) → null, échec franc', () => {
    expect(extractJsonObject('{"claims": [{"claim": "coupé en plein')).toBeNull()
  })

  it('aucun JSON → null', () => {
    expect(extractJsonObject('Pas de JSON ici.')).toBeNull()
  })
})
