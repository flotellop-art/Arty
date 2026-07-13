import { describe, expect, it, vi } from 'vitest'
import {
  GMAIL_HOME_URL,
  compileGmailSearch,
  copyThenOpenGmail,
  isGmailSearchIntent,
  isValidGmailSearchPayload,
  validateGmailSearchQuery,
} from '../../services/gmailSearchHandoff'

describe('Gmail search handoff — deterministic local compiler', () => {
  it.each([
    'Retrouve le mail de Paul au sujet du devis de juin',
    'Montre-moi mes emails non lus',
    'Find the email from alice@example.com about renewal',
    'Mes mails avec une pièce jointe',
  ])('détecte une recherche globale : %s', (source) => {
    expect(isGmailSearchIntent(source)).toBe(true)
  })

  it.each([
    'Rédige un email à Paul',
    'Écris-moi un message chaleureux',
    'Compare deux modèles pour ma réponse',
  ])("n'intercepte pas la rédaction : %s", (source) => {
    expect(isGmailSearchIntent(source)).toBe(false)
  })

  it('compile expéditeur, sujet et mois avec une hypothèse visible', () => {
    const result = compileGmailSearch(
      'Retrouve le mail de Paul au sujet du devis de juin',
      new Date('2026-07-13T10:00:00Z'),
    )

    expect(result?.payload.query).toBe(
      'from:Paul subject:devis after:2026/06/01 before:2026/07/01',
    )
    expect(result?.payload.assumptions).toEqual([
      { kind: 'date', label: 'juin 2026' },
    ])
  })

  it('conserve uniquement une adresse présente dans la demande', () => {
    const source = 'Find the email from alice@example.com about renewal'
    const result = compileGmailSearch(source, new Date('2026-07-13T10:00:00Z'))
    expect(result?.payload.query).toContain('from:alice@example.com')
    expect(validateGmailSearchQuery('from:bob@example.com renewal', source)).toBe(false)
  })

  it('rend les filtres non-lu et pièce jointe sans réseau', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = compileGmailSearch('Montre mes mails non lus avec pièce jointe')
    expect(result?.payload.query).toContain('is:unread')
    expect(result?.payload.query).toContain('has:attachment')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('refuse opérateurs, URLs et caractères bidi hors allowlist', () => {
    expect(validateGmailSearchQuery('label:secret', 'label secret')).toBe(false)
    expect(validateGmailSearchQuery('from:paul https://example.com', 'paul')).toBe(false)
    expect(validateGmailSearchQuery('from:paul\u202E', 'paul')).toBe(false)
  })

  it('copie complètement avant toute ouverture', async () => {
    const events: string[] = []
    await copyThenOpenGmail('from:paul', {
      copy: async () => { events.push('copy:start'); await Promise.resolve(); events.push('copy:end') },
      open: async () => { events.push('open') },
    })
    expect(events).toEqual(['copy:start', 'copy:end', 'open'])
  })

  it("n'ouvre pas Gmail si la copie échoue", async () => {
    const open = vi.fn(async () => {})
    await expect(copyThenOpenGmail('from:paul', {
      copy: async () => { throw new Error('clipboard_unavailable') },
      open,
    })).rejects.toThrow('clipboard_unavailable')
    expect(open).not.toHaveBeenCalled()
  })

  it("distingue l'échec d'ouverture après une copie réussie", async () => {
    await expect(copyThenOpenGmail('from:paul', {
      copy: async () => {},
      open: async () => { throw new Error('popup blocked') },
    })).rejects.toThrow('gmail_open_failed')
  })

  it('ouvre uniquement la racine Gmail, sans compte, query ou callback', () => {
    expect(GMAIL_HOME_URL).toBe('https://mail.google.com/')
    const url = new URL(GMAIL_HOME_URL)
    expect(url.pathname).toBe('/')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
  })

  it('expire le payload local au bout d’une heure', () => {
    const now = new Date('2026-07-13T10:00:00Z')
    const payload = compileGmailSearch('Cherche le mail de Paul', now)?.payload
    expect(payload && isValidGmailSearchPayload(payload, now.getTime())).toBe(true)
    expect(payload && isValidGmailSearchPayload(payload, now.getTime() + 60 * 60 * 1000 + 1)).toBe(false)
  })

  it('rejette un payload importé futur ou avec un opérateur non autorisé', () => {
    const now = Date.now()
    const base = compileGmailSearch('Cherche le mail de Paul', new Date(now))!.payload
    expect(isValidGmailSearchPayload({ ...base, createdAt: now + 120_000, expiresAt: now + 180_000 }, now)).toBe(false)
    expect(isValidGmailSearchPayload({ ...base, query: 'label:secret' }, now)).toBe(false)
    expect(isValidGmailSearchPayload({ ...base, afterOpen: 'delete' }, now)).toBe(false)
    expect(isValidGmailSearchPayload({ ...base, afterOpen: 'summarize' }, now)).toBe(true)
  })
})
