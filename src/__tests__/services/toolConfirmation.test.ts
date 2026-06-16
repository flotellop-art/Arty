import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { buildToolConfirmMessage } from '../../services/toolConfirmation'

// Faux `t` : renvoie la clé + les params, suffisant pour vérifier QUELLE clé
// est choisie et QUELS params sont passés, sans charger i18next.
const fakeT = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as unknown as TFunction

describe('buildToolConfirmMessage — garde HITL boucle d\'outils', () => {
  it('exige une confirmation sur les envois externes / exfiltration', () => {
    expect(buildToolConfirmMessage('send_email', { to: 'a@b.c' }, fakeT)).toContain('chat.actionConfirm.email')
    expect(buildToolConfirmMessage('send_email', { to: 'a@b.c' }, fakeT)).toContain('a@b.c')
    expect(buildToolConfirmMessage('reply_email', { to: 'x@y.z' }, fakeT)).toContain('chat.actionConfirm.email')
    expect(buildToolConfirmMessage('share_drive_file', { email: 'tiers@x.com' }, fakeT)).toContain('chat.actionConfirm.shareDrive')
    expect(buildToolConfirmMessage('share_drive_file', { email: 'tiers@x.com' }, fakeT)).toContain('tiers@x.com')
  })

  it('exige une confirmation sur toutes les suppressions destructives', () => {
    expect(buildToolConfirmMessage('delete_email', {}, fakeT)).toBe('chat.actionConfirm.deleteEmail')
    expect(buildToolConfirmMessage('delete_drive_file', {}, fakeT)).toBe('chat.actionConfirm.deleteDrive')
    expect(buildToolConfirmMessage('delete_calendar_event', {}, fakeT)).toBe('chat.actionConfirm.deleteEvent')
    expect(buildToolConfirmMessage('delete_local_file', {}, fakeT)).toBe('chat.actionConfirm.deleteLocal')
    expect(buildToolConfirmMessage('wp_delete_post', {}, fakeT)).toBe('chat.actionConfirm.deleteWp')
  })

  it('WordPress : confirme la publication publique mais PAS les brouillons', () => {
    expect(buildToolConfirmMessage('wp_create_post', { title: 'T', status: 'publish' }, fakeT)).toContain('chat.actionConfirm.wp')
    expect(buildToolConfirmMessage('publish_wordpress', { title: 'T', status: 'publish' }, fakeT)).toContain('chat.actionConfirm.wp')
    // brouillon = pas de garde
    expect(buildToolConfirmMessage('wp_create_post', { title: 'T', status: 'draft' }, fakeT)).toBeNull()
    // status absent → défaut 'draft' → pas de garde
    expect(buildToolConfirmMessage('wp_create_post', { title: 'T' }, fakeT)).toBeNull()
  })

  it('laisse passer librement les lectures / recherches / listings', () => {
    for (const safe of [
      'read_emails', 'read_email', 'read_email_attachment', 'search_emails',
      'list_drive', 'search_drive', 'read_drive_file', 'create_drive_file',
      'create_drive_folder', 'rename_drive_file', 'move_drive_file', 'copy_drive_file',
      'list_calendar', 'create_calendar_event', 'list_local_files', 'read_local_file',
      'web_search', 'ask_user', 'update_memory', 'wp_list_posts',
    ]) {
      expect(buildToolConfirmMessage(safe, {}, fakeT)).toBeNull()
    }
  })

  it('tombe en sécurité sur un outil inconnu (pas de garde, mais le toolExecutor le rejettera)', () => {
    expect(buildToolConfirmMessage('outil_inexistant', {}, fakeT)).toBeNull()
  })
})
