// P1.1 — mémoire automatique : tests des helpers purs (filtre de substance,
// transcript borné). La logique réseau/storage est volontairement hors scope
// (fire-and-forget, garde-fous testés via le comportement des helpers).
import { describe, it, expect } from 'vitest'
import { hasSubstance, buildTranscript, hasEuData, EXTRACT_EVERY_N_USER_MSGS } from '../../services/autoMemory'

describe('autoMemory helpers', () => {
  it('rejette les conversations sans substance (ok / merci)', () => {
    expect(hasSubstance(['ok', 'merci', 'bonne journée'])).toBe(false)
  })

  it('accepte les messages substantiels (>150 chars cumulés)', () => {
    const msg = 'Je suis garagiste à Lyon et je cherche à automatiser mes devis. '
    expect(hasSubstance([msg, msg, msg])).toBe(true)
  })

  it('borne chaque message du transcript à 800 chars', () => {
    const long = 'x'.repeat(2000)
    const transcript = buildTranscript([long])
    expect(transcript.length).toBeLessThanOrEqual(810)
    expect(transcript.startsWith('- ')).toBe(true)
  })

  it('formate plusieurs messages en liste', () => {
    const t = buildTranscript(['premier', 'second'])
    expect(t).toBe('- premier\n- second')
  })

  it('le debounce est de 3 messages user (contrat du design P1.1)', () => {
    expect(EXTRACT_EVERY_N_USER_MSGS).toBe(3)
  })
})

describe('hasEuData — garde EU de l\'extraction mémoire', () => {
  it('bloque les conversations euOnly', () => {
    expect(hasEuData({ euOnly: true })).toBe(true)
  })

  it('bloque les conversations mixtes ayant touché Mistral (même sans euOnly)', () => {
    expect(hasEuData({ euOnly: false, usedModels: ['claude', 'mistral'] })).toBe(true)
    expect(hasEuData({ usedModels: ['mistral'] })).toBe(true)
  })

  it('laisse passer les conversations sans données EU', () => {
    expect(hasEuData({})).toBe(false)
    expect(hasEuData({ euOnly: false, usedModels: ['claude', 'gemini'] })).toBe(false)
  })
})
