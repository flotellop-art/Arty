import { describe, expect, it } from 'vitest'
import {
  isGmailNoCasaPhase0Enabled,
  isNoCasaBlockedTool,
} from '../../services/gmailNoCasaPhase0'
import {
  GMAIL_NO_CASA_PHASE0_GOOGLE_SCOPES,
  getGoogleOAuthScopes,
} from '../../services/googleAuth'
import { buildToolDefinitions } from '../../services/toolDefinitions'

const RESTRICTED_SCOPE_FRAGMENTS = [
  '/auth/gmail.readonly',
  '/auth/gmail.modify',
  '/auth/gmail.compose',
  '/auth/drive',
  '/auth/contacts',
]

describe('Gmail no-CASA Phase 0 build profile', () => {
  it('reste désactivé par défaut et exige une valeur explicite', () => {
    expect(isGmailNoCasaPhase0Enabled(undefined)).toBe(false)
    expect(isGmailNoCasaPhase0Enabled('false')).toBe(false)
    expect(isGmailNoCasaPhase0Enabled('true')).toBe(true)
    expect(isGmailNoCasaPhase0Enabled('1')).toBe(true)
  })

  it('retire Gmail, Drive et Contacts des scopes du client principal', () => {
    const scopes = getGoogleOAuthScopes(true)
    expect(scopes).toEqual(GMAIL_NO_CASA_PHASE0_GOOGLE_SCOPES)
    for (const fragment of RESTRICTED_SCOPE_FRAGMENTS) {
      expect(scopes.some((scope) => scope.includes(fragment))).toBe(false)
    }
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar')
  })

  it('retire les outils globaux Gmail, Drive et Contacts tout en gardant Calendar', () => {
    const names = buildToolDefinitions(true).map((tool) => (tool as { name?: string }).name)
    expect(names).toContain('list_calendar')
    expect(names).not.toContain('read_emails')
    expect(names).not.toContain('search_drive')
    expect(names).not.toContain('search_contacts')
  })

  it('bloque les anciens outils même si un message historique tente de les appeler', () => {
    expect(isNoCasaBlockedTool('send_email')).toBe(true)
    expect(isNoCasaBlockedTool('read_drive_file')).toBe(true)
    expect(isNoCasaBlockedTool('search_contacts')).toBe(true)
    expect(isNoCasaBlockedTool('list_calendar')).toBe(false)
  })
})
