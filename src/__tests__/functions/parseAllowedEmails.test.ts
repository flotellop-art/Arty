import { describe, it, expect } from 'vitest'
import { parseAllowedEmails } from '../../../functions/api/_lib/checkAllowedUser'

// Audit F-5 (3 juil. 2026) — la whitelist RÈGLE 2 est le gate d'accès aux
// clés serveur : un parse trop laxiste ou trop strict casse l'auth de tous
// les VIP. Ces cas couvrent les formats réellement saisis à la main dans
// l'UI Cloudflare (virgules, points-virgules, retours ligne, guillemets).
describe('parseAllowedEmails — whitelist RÈGLE 2', () => {
  it('retourne [] pour undefined / vide', () => {
    expect(parseAllowedEmails(undefined)).toEqual([])
    expect(parseAllowedEmails('')).toEqual([])
  })

  it('parse une liste simple séparée par virgules', () => {
    expect(parseAllowedEmails('a@x.com,b@y.com')).toEqual(['a@x.com', 'b@y.com'])
  })

  it('tolère espaces, points-virgules et retours ligne', () => {
    expect(parseAllowedEmails(' a@x.com ; b@y.com\nc@z.com ')).toEqual([
      'a@x.com', 'b@y.com', 'c@z.com',
    ])
  })

  it('normalise la casse en minuscules (cohérence D1 : emails lowercase partout)', () => {
    expect(parseAllowedEmails('Flo@Gmail.COM')).toEqual(['flo@gmail.com'])
  })

  it("retire les guillemets d'enveloppe", () => {
    expect(parseAllowedEmails('"a@x.com", \'b@y.com\'')).toEqual(['a@x.com', 'b@y.com'])
  })

  it('filtre les entrées vides (virgules doublées, trailing)', () => {
    expect(parseAllowedEmails('a@x.com,,b@y.com,')).toEqual(['a@x.com', 'b@y.com'])
  })
})
