import { describe, expect, it } from 'vitest'
import { selectMistralModel } from '../../services/mistralClient'

describe('selectMistralModel — efficacité sans perte de capacité', () => {
  it.each(['merci beaucoup', 'bonjour !', '2 + 2 = ?'])(
    '« %s » → Small 4',
    (message) => expect(selectMistralModel(message)).toBe('mistral-small-2603')
  )

  it.each([
    'Rédige un mail de relance professionnel',
    'Montre mes emails non lus',
    'Analyse cette stratégie commerciale',
    'Bonjour, analyse cette stratégie commerciale',
    'oui, rédige le contrat',
  ])('« %s » → Medium 3.5', (message) => {
    expect(selectMistralModel(message)).toBe('mistral-medium-latest')
  })
})
