// Tests de non-régression sur formatModelName — ajoutés avec la migration
// Sonnet 4.6 → Sonnet 5 (pattern BUG 56 : chaque fix de regex embarque son
// test, sinon la prochaine refacto casse l'affichage sans que personne ne
// le voie). La regex de version doit gérer les IDs à UN chiffre
// (claude-sonnet-5), à deux (claude-opus-4-8) et les suffixes datés
// (claude-haiku-4-5-20251001) sans capter la date comme version mineure.

import { describe, expect, it } from 'vitest'
import { formatModelName } from '../../services/modelLabels'

describe('formatModelName — Claude version extraction', () => {
  it('claude-sonnet-5 → Claude Sonnet 5 (version à un chiffre)', () => {
    expect(formatModelName('claude-sonnet-5')).toBe('Claude Sonnet 5')
  })

  it('claude-sonnet-4-6 → Claude Sonnet 4.6 (legacy, coûts historiques)', () => {
    expect(formatModelName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6')
  })

  it('claude-opus-4-8 → Claude Opus 4.8', () => {
    expect(formatModelName('claude-opus-4-8')).toBe('Claude Opus 4.8')
  })

  it('claude-haiku-4-5-20251001 → Claude Haiku 4.5 (la date YYYYMMDD n\'est pas une version)', () => {
    expect(formatModelName('claude-haiku-4-5-20251001')).toBe('Claude Haiku 4.5')
  })

  it('claude-sonnet-5-20260815 → Claude Sonnet 5 (futur ID daté hypothétique)', () => {
    expect(formatModelName('claude-sonnet-5-20260815')).toBe('Claude Sonnet 5')
  })

  it('id claude sans version → label famille sans numéro', () => {
    expect(formatModelName('claude-sonnet-latest')).toBe('Claude Sonnet')
  })
})

describe('formatModelName — autres providers (non-régression)', () => {
  it('mistral-medium-latest → Mistral Medium 3.5', () => {
    expect(formatModelName('mistral-medium-latest')).toBe('Mistral Medium 3.5')
  })

  it('gemini-2.5-pro → Gemini Pro', () => {
    expect(formatModelName('gemini-2.5-pro')).toBe('Gemini Pro')
  })

  it('gpt-5.5 → GPT-5.5', () => {
    expect(formatModelName('gpt-5.5')).toBe('GPT-5.5')
  })
})
