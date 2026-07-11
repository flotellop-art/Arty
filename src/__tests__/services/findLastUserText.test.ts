// Refonte routage (étape 0) — findLastUserText doit lire le message user
// COURANT même quand son content est un tableau de blocks (fichier attaché,
// buildContentBlocks). L'ancienne version sautait ces messages et retombait
// sur le tour PRÉCÉDENT : thinking / sous-modèle / web search se calculaient
// alors sur la mauvaise question.
import { describe, expect, it } from 'vitest'
import { findLastUserText } from '../../services/anthropicClient'

describe('findLastUserText', () => {
  it('retourne le dernier message user en string simple', () => {
    const messages = [
      { role: 'user', content: 'première question' },
      { role: 'assistant', content: 'réponse' },
      { role: 'user', content: 'analyse ce rapport stratégique' },
    ]
    expect(findLastUserText(messages)).toBe('analyse ce rapport stratégique')
  })

  it('extrait le texte des blocks quand un fichier est attaché (cas corrigé)', () => {
    const messages = [
      { role: 'user', content: 'bonjour' },
      { role: 'assistant', content: 'salut !' },
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } },
          { type: 'text', text: 'fais-moi un rapport stratégique sur ce document' },
        ],
      },
    ]
    // Avant le fix : retournait 'bonjour' (tour précédent) → routage faussé.
    expect(findLastUserText(messages)).toBe('fais-moi un rapport stratégique sur ce document')
  })

  it('concatène plusieurs blocks text du même message', () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'partie 1' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'partie 2' },
        ],
      },
    ]
    expect(findLastUserText(messages)).toBe('partie 1\npartie 2')
  })

  it('retombe sur le tour précédent si le message à blocks ne contient aucun texte', () => {
    const messages = [
      { role: 'user', content: 'question initiale' },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
      },
    ]
    expect(findLastUserText(messages)).toBe('question initiale')
  })

  it('ignore les messages assistant et retourne vide sans message user', () => {
    expect(findLastUserText([{ role: 'assistant', content: 'seul' }])).toBe('')
    expect(findLastUserText([])).toBe('')
  })
})
