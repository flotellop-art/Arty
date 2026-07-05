// Tests de non-régression sur formatModelName — ajoutés avec la migration
// Sonnet 4.6 → Sonnet 5 (pattern BUG 56 : chaque fix de regex embarque son
// test, sinon la prochaine refacto casse l'affichage sans que personne ne
// le voie). La regex de version doit gérer les IDs à UN chiffre
// (claude-sonnet-5), à deux (claude-opus-4-8) et les suffixes datés
// (claude-haiku-4-5-20251001) sans capter la date comme version mineure.

import { describe, expect, it } from 'vitest'
import { formatModelName, getModelCapacityKey, getModelRegion } from '../../services/modelLabels'
import { calculateCost } from '../../services/costTracker'

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

describe('formatModelName — autres providers (anti-drift C-D)', () => {
  it('mistral : famille SANS numéro de version (alias mouvants -latest / ids datés)', () => {
    // « Mistral Medium 3.5 » codé en dur mentait dès que l'alias bougeait
    // (audit F-12) : la version vient de l'ID ou n'est pas affichée.
    expect(formatModelName('mistral-medium-latest')).toBe('Mistral Medium')
    expect(formatModelName('mistral-medium-2505')).toBe('Mistral Medium')
    expect(formatModelName('mistral-large-latest')).toBe('Mistral Large')
    expect(formatModelName('mistral-small-latest')).toBe('Mistral Small')
  })

  it('gemini : version extraite de l\'ID — 2.5 et 3.5 ne sont plus fondus', () => {
    expect(formatModelName('gemini-2.5-flash')).toBe('Gemini 2.5 Flash')
    expect(formatModelName('gemini-3.5-flash')).toBe('Gemini 3.5 Flash')
    expect(formatModelName('gemini-2.5-pro')).toBe('Gemini 2.5 Pro')
    expect(formatModelName('gemini-2.5-flash-lite')).toBe('Gemini 2.5 Flash Lite')
  })

  it('gpt : version dérivée de l\'ID', () => {
    expect(formatModelName('gpt-5.5')).toBe('GPT-5.5')
    expect(formatModelName('gpt-5')).toBe('GPT-5')
    expect(formatModelName('gpt-5-mini')).toBe('GPT-5 Mini')
    expect(formatModelName('gpt-4o-mini')).toBe('GPT-4o Mini')
  })
})

// Test de PARITÉ (C-D — pattern F-1 toolConfirmation) : tout ID que le code
// peut réellement router DOIT avoir un label produit, une région, une
// capacité non-fallback et un coût connu. Tout NOUVEAU modèle (RÈGLE 3)
// s'ajoute ici — CI rouge sinon, ce qui force la mise à jour des 4 mappings
// d'un coup (fin de la dérive silencieuse des labels).
describe('parité IDs routables ↔ labels / région / capacité / coûts', () => {
  const ROUTABLE_IDS: Array<[id: string, source: string]> = [
    ['claude-haiku-4-5-20251001', 'selectClaudeSubModel + cible du swap trial (proxy.ts)'],
    ['claude-sonnet-5', 'selectClaudeSubModel défaut'],
    ['claude-opus-4-8', 'selectClaudeSubModel rapports Pro'],
    ['mistral-medium-latest', 'selectMistralModel + cible du swap trial (mistral-proxy.ts)'],
    ['gemini-2.5-flash', 'GEMINI_CHAT_MODEL'],
    ['gemini-3.5-flash', 'GEMINI_RESEARCH_MODEL + killswitch arty-gemini-cheap-disabled'],
    ['gemini-2.5-pro', 'comparateur (providerCatalog)'],
    ['gpt-5.5', 'DEFAULT_MODEL openaiClient'],
    ['gpt-5', 'FALLBACK_MODEL openaiClient'],
    ['gpt-5-mini', 'TRIAL_ALLOWED_MODELS + comparateur'],
    ['mistral-large-latest', 'comparateur'],
    ['mistral-small-latest', 'comparateur'],
  ]

  it.each(ROUTABLE_IDS)('%s (%s)', (id) => {
    // Label produit ≠ id brut (l'utilisateur ne doit jamais voir un slug).
    expect(formatModelName(id)).not.toBe(id)
    // Région connue (drapeau + clé i18n).
    const region = getModelRegion(id)
    expect(['🇪🇺', '🇺🇸']).toContain(region.flag)
    // Capacité : jamais le fallback pour un ID routable.
    expect(getModelCapacityKey(id)).not.toBe('chat.modelFooter.capacity.fallback')
    // Coût connu (bucket de prix résolu — un coût 0 = entrée pricing absente).
    expect(calculateCost(id, 1_000_000, 1_000_000)).toBeGreaterThan(0)
  })
})
