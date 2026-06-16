import { describe, it, expect } from 'vitest'
import type { Conversation, Message } from '../../types'
import {
  scoreConversation,
  firstSnippet,
  rankConversations,
} from '../../services/conversationSearch'

function m(content: string): Message {
  return { id: Math.random().toString(36), role: 'user', content, timestamp: 0 }
}

function conv(over: Partial<Conversation> & { id: string; title: string }): Conversation {
  return {
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('scoreConversation', () => {
  it('match dans le titre > match dans le corps seul', () => {
    const titleHit = scoreConversation('Facture Dupont', [], [m('rien')], 'dupont')
    const bodyHit = scoreConversation('Sans rapport', [], [m('paye Dupont vite')], 'dupont')
    expect(titleHit).toBeGreaterThan(bodyHit)
    expect(bodyHit).toBeGreaterThan(0)
  })

  it('bonus si le titre commence par la requête', () => {
    const prefix = scoreConversation('Dupont facture', [], [], 'dupont')
    const middle = scoreConversation('Ma facture Dupont', [], [], 'dupont')
    expect(prefix).toBeGreaterThan(middle)
  })

  it('compte les messages qui matchent, plafonné (deux comptes au-dessus du cap = égaux)', () => {
    const many = scoreConversation('x', [], Array.from({ length: 12 }, () => m('dupont')), 'dupont')
    const fewerButCapped = scoreConversation('x', [], Array.from({ length: 8 }, () => m('dupont')), 'dupont')
    expect(many).toBe(fewerButCapped) // plafonné
  })

  it('match de tag', () => {
    expect(scoreConversation('x', ['travail'], [], 'travail')).toBeGreaterThan(0)
  })

  it('insensible aux accents (resume ~ Résumé), des deux côtés', () => {
    expect(scoreConversation('Résumé du projet', [], [], 'resume')).toBeGreaterThan(0)
    expect(scoreConversation('Note', [], [m('la tâche urgente')], 'tache')).toBeGreaterThan(0)
  })

  it('0 si aucun match', () => {
    expect(scoreConversation('rien', [], [m('rien du tout')], 'zorglub')).toBe(0)
  })

  it('ne plante pas sur une conversation sans messages', () => {
    expect(scoreConversation('Dupont', [], [], 'dupont')).toBeGreaterThan(0)
    expect(scoreConversation('rien', [], [], 'dupont')).toBe(0)
  })
})

describe('firstSnippet', () => {
  it('renvoie un extrait contenant le terme du 1er message qui matche', () => {
    const s = firstSnippet([m('aucun rapport'), m('voici la facture de Dupont à payer')], 'dupont')
    expect(s).toBeTruthy()
    expect(s!.toLowerCase()).toContain('dupont')
  })

  it('ajoute des ellipses quand le contenu déborde', () => {
    const long = 'a'.repeat(100) + ' dupont ' + 'b'.repeat(100)
    const s = firstSnippet([m(long)], 'dupont')
    expect(s!.startsWith('…')).toBe(true)
    expect(s!.endsWith('…')).toBe(true)
  })

  it('null si aucun message ne matche', () => {
    expect(firstSnippet([m('rien')], 'zorglub')).toBeNull()
  })
})

describe('rankConversations', () => {
  const tagsOf = (c: Conversation) => c.tags ?? []

  it('requête vide → liste inchangée, pas de snippets', () => {
    const list = [conv({ id: 'a', title: 'A' }), conv({ id: 'b', title: 'B' })]
    const r = rankConversations(list, '', tagsOf)
    expect(r.conversations).toBe(list)
    expect(r.snippets).toEqual({})
  })

  it('classe le match titre avant le match corps seul', () => {
    const titleHit = conv({ id: 'title', title: 'Dossier Dupont', updatedAt: 1 })
    const bodyHit = conv({ id: 'body', title: 'Autre', messages: [m('Dupont mentionné')], updatedAt: 999 })
    const r = rankConversations([bodyHit, titleHit], 'dupont', tagsOf)
    expect(r.conversations[0]!.id).toBe('title')
    expect(r.conversations[1]!.id).toBe('body')
  })

  it('départage par récence à score égal', () => {
    const older = conv({ id: 'old', title: 'Dupont', updatedAt: 1 })
    const newer = conv({ id: 'new', title: 'Dupont', updatedAt: 2 })
    const r = rankConversations([older, newer], 'dupont', tagsOf)
    expect(r.conversations[0]!.id).toBe('new')
  })

  it('snippet présent pour un match corps, absent pour un match titre', () => {
    const titleHit = conv({ id: 'title', title: 'Dupont' })
    const bodyHit = conv({ id: 'body', title: 'Autre', messages: [m('facture Dupont payée')] })
    const r = rankConversations([titleHit, bodyHit], 'dupont', tagsOf)
    expect(r.snippets['body']).toBeTruthy()
    expect(r.snippets['title']).toBeUndefined()
  })

  it('exclut les conversations sans match', () => {
    const hit = conv({ id: 'hit', title: 'Dupont' })
    const miss = conv({ id: 'miss', title: 'Rien', messages: [m('autre chose')] })
    const r = rankConversations([hit, miss], 'dupont', tagsOf)
    expect(r.conversations.map((c) => c.id)).toEqual(['hit'])
  })

  it('match par tag seul : conv incluse, pas de snippet (titre/corps ne matchent pas)', () => {
    const tagged = conv({ id: 'tag', title: 'Sans rapport', tags: ['travail'], messages: [m('rien')] })
    const r = rankConversations([tagged], 'travail', (c) => c.tags ?? [])
    expect(r.conversations.map((c) => c.id)).toEqual(['tag'])
    expect(r.snippets['tag']).toBeUndefined()
  })

  it('recherche insensible aux accents (resume trouve « Résumé »)', () => {
    const c = conv({ id: 'r', title: 'Résumé hebdo' })
    const r = rankConversations([c], 'resume', tagsOf)
    expect(r.conversations.map((x) => x.id)).toEqual(['r'])
  })
})
