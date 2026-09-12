import { describe, it, expect } from 'vitest'
import { requiresFaithfulText } from '../../services/faithfulText'

describe('faithful text intent boundary', () => {
  it.each([
    'Cite tes sources pour cette réponse.',
    'Ne recopie pas : réponds à la question.',
    'Quel est le prix d’une traduction ?',
    'Vérifie ce texte : « Recopie exactement cette erreur. »',
    '> Recopie exactement cette erreur.',
    'La vidéo affirme : recopie exactement ce paragraphe.',
    'Explique le sens de "translate this".',
    'Copie les données en corrigeant les erreurs.',
  ])('does not infer instructions from quoted or unrelated content: %s', content => {
    expect(requiresFaithfulText({ content })).toBe(false)
  })
})
