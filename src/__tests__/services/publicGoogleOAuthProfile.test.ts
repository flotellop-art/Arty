import { describe, expect, it } from 'vitest'
import {
  isPublicGoogleOAuthProfileEnabled,
  isBlockedPublicGoogleTool,
} from '../../services/publicGoogleOAuthProfile'
import {
  PUBLIC_GOOGLE_SCOPES,
  getGoogleOAuthScopes,
} from '../../services/googleAuth'
import { buildToolDefinitions } from '../../services/toolDefinitions'
import { SYSTEM_PROMPT } from '../../constants/systemPrompt'

const RESTRICTED_SCOPE_FRAGMENTS = [
  '/auth/gmail.readonly',
  '/auth/gmail.modify',
  '/auth/gmail.compose',
  '/auth/drive',
  '/auth/contacts',
]

const LEGACY_MAILBOX_TOOLS = [
  'read_emails',
  'read_email',
  'read_email_attachment',
  'search_emails',
  'send_email',
  'reply_email',
  'archive_email',
  'delete_email',
  'star_email',
  'unstar_email',
]

describe('profil Google public sans boîte mail', () => {
  it('est permanent et ne dépend d’aucun flag de build', () => {
    expect(isPublicGoogleOAuthProfileEnabled()).toBe(true)
  })

  it('retire Gmail, Drive et Contacts des scopes du client principal', () => {
    const scopes = getGoogleOAuthScopes()
    expect(scopes).toEqual(PUBLIC_GOOGLE_SCOPES)
    for (const fragment of RESTRICTED_SCOPE_FRAGMENTS) {
      expect(scopes.some((scope) => scope.includes(fragment))).toBe(false)
    }
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar')
  })

  it('retire les outils globaux Gmail, Drive, Contacts et Sheets tout en gardant Calendar', () => {
    const names = buildToolDefinitions().map((tool) => (tool as { name?: string }).name)
    expect(names).toContain('list_calendar')
    expect(names).not.toContain('read_emails')
    expect(names).not.toContain('search_drive')
    expect(names).not.toContain('search_contacts')
    expect(names).not.toContain('export_clients_to_sheets')
    expect(names).not.toContain('export_projets_to_sheets')
  })

  it('ne déclare aucun outil de boîte mail', () => {
    const names = buildToolDefinitions().map((tool) => (tool as { name?: string }).name)
    for (const legacyName of LEGACY_MAILBOX_TOOLS) {
      expect(names).not.toContain(legacyName)
    }
  })

  it('dit explicitement de travailler uniquement sur le contenu fourni', () => {
    expect(SYSTEM_PROMPT).toContain("Tu n'as accès à aucune boîte mail")
    expect(SYSTEM_PROMPT).toContain("colle, joint ou partage")
    expect(SYSTEM_PROMPT).toContain("Tu ne l'envoies pas")
  })

  it('bloque les anciens outils même si un message historique tente de les appeler', () => {
    expect(isBlockedPublicGoogleTool('read_drive_file')).toBe(true)
    expect(isBlockedPublicGoogleTool('search_contacts')).toBe(true)
    expect(isBlockedPublicGoogleTool('export_clients_to_sheets')).toBe(true)
    expect(isBlockedPublicGoogleTool('export_projets_to_sheets')).toBe(true)
    expect(isBlockedPublicGoogleTool('list_calendar')).toBe(false)
  })
})
