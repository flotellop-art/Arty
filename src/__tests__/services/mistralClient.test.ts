// Tests de shouldForceSearch (fix 429 du 11 juin 2026) — la décision de
// forcer web_search au 1er tour. Le bug live : contenu d'article déjà
// inliné (lot C) + recherche quand même forcée (lot D) = appels Mistral
// dos à dos → rate limit upstream.
import { describe, it, expect } from 'vitest'
import { shouldForceSearch } from '../../services/mistralClient'

describe('shouldForceSearch', () => {
  it('question actualité sans contenu inliné → forcer', () => {
    expect(shouldForceSearch('quel temps demain à Voiron ?', true, false)).toBe(true)
  })

  it('contenu d\'URL déjà inliné → ne JAMAIS forcer (bug live 11 juin)', () => {
    expect(
      shouldForceSearch(
        'Résumé cet article https://www.lefigaro.fr/...\n\n--- CONTENU DE LA PAGE ---\n…',
        true,
        true
      )
    ).toBe(false)
  })

  it('pas de tool handler (comparateur) → jamais de forçage', () => {
    expect(shouldForceSearch('quel temps demain ?', false, false)).toBe(false)
  })

  it('small talk → pas de forçage même sans contenu inliné', () => {
    expect(shouldForceSearch('salut ça va ?', true, false)).toBe(false)
  })

  it('décision centrale privée → jamais de recherche, même sur une requête récente', () => {
    expect(shouldForceSearch('quel temps demain ?', true, false, false)).toBe(false)
  })
})
