import { describe, expect, it } from 'vitest'
import { REPORT_ACTION_NAMES, isAllowedReportAction, parseTrailRouteId } from '../../services/reportActions'

// Boutons d'action des messages — allowlist positive (audit 14 juin) + garde
// d'entrée view_trail. Le data-route-id vient d'un bouton généré par le LLM :
// même classe de risque que BUG 32 (ids non validés), validation stricte.

describe('reportActions — allowlist', () => {
  it('view_trail est une action autorisée', () => {
    expect(isAllowedReportAction('view_trail')).toBe(true)
    expect(REPORT_ACTION_NAMES.has('view_trail')).toBe(true)
  })

  it('les actions retirées du produit restent refusées', () => {
    expect(isAllowedReportAction('send_email')).toBe(false)
    expect(isAllowedReportAction('save_drive')).toBe(false)
    expect(isAllowedReportAction('anything_else')).toBe(false)
  })
})

describe('parseTrailRouteId — validation stricte (classe BUG 32)', () => {
  it('accepte un id de relation OSM numérique', () => {
    expect(parseTrailRouteId('18675656')).toBe(18675656)
    expect(parseTrailRouteId('1')).toBe(1)
  })

  it.each([
    ['vide', ''],
    ['négatif', '-5'],
    ['décimal', '1.5'],
    ['zéro', '0'],
    ['injection', '1;DROP TABLE'],
    ['path traversal', '../42'],
    ['espaces', ' 42'],
    ['exponentielle', '1e10'],
    ['trop long', '1234567890123456'],
  ])('rejette %s (%s)', (_label, raw) => {
    expect(parseTrailRouteId(raw)).toBeNull()
  })

  it('rejette les types non-string (dataset absent → undefined)', () => {
    expect(parseTrailRouteId(undefined)).toBeNull()
    expect(parseTrailRouteId(42)).toBeNull()
    expect(parseTrailRouteId(null)).toBeNull()
  })
})
