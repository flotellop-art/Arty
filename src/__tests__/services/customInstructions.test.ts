// P1.2 — custom instructions : injection dans le system prompt + cap.
import { describe, it, expect } from 'vitest'
import { buildContextualPrompt } from '../../constants/systemPrompt'
import { MAX_CUSTOM_INSTRUCTIONS_CHARS } from '../../services/customInstructions'

describe('custom instructions in system prompt', () => {
  it('injecte les instructions en tête avec un label de priorité', () => {
    const out = buildContextualPrompt({ customInstructions: 'Vouvoie-moi toujours.' })
    expect(out).toContain('Vouvoie-moi toujours.')
    expect(out).toContain('PRIORITÉ ABSOLUE')
    // Doit apparaître AVANT le corps du prompt de base.
    expect(out.indexOf('Vouvoie-moi')).toBeLessThan(out.indexOf('COMPORTEMENT'))
  })

  it('n\'ajoute rien quand le champ est vide', () => {
    const base = buildContextualPrompt()
    const withEmpty = buildContextualPrompt({ customInstructions: '' })
    expect(withEmpty).toBe(base)
    expect(withEmpty).not.toContain('PRIORITÉ ABSOLUE')
  })

  it('trim les espaces autour des instructions', () => {
    const out = buildContextualPrompt({ customInstructions: '   sois concis   ' })
    expect(out).toContain('sois concis\n')
    expect(out).not.toContain('   sois concis   ')
  })

  it('cap raisonnable (500 chars) — borne le contexte permanent', () => {
    expect(MAX_CUSTOM_INSTRUCTIONS_CHARS).toBe(500)
  })
})
