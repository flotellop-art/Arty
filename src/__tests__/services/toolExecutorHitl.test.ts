import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildToolConfirmMessage,
  createToolExecutor,
  requiresDestructiveToolConfirmation,
  type DestructiveToolConfirmationRequest,
} from '../../services/toolExecutor'

type ConfirmFn = (request: DestructiveToolConfirmationRequest) => boolean | Promise<boolean>

function createHarness(confirmDestructiveTool?: ConfirmFn) {
  const unreadMessages = [
    { id: 'm1', threadId: 'thread-1', from: 'alice@example.com', subject: 'Hello', snippet: 'Preview' },
  ]
  const gmail = {
    messages: unreadMessages,
    fetchMessages: vi.fn().mockResolvedValue(unreadMessages),
    sendEmail: vi.fn().mockResolvedValue({ id: 'sent-1', threadId: 'thread-1' }),
  }

  const executor = createToolExecutor(
    {} as never,
    gmail as never,
    {} as never,
    { searchPrices: vi.fn(), publishWP: vi.fn() } as never,
    confirmDestructiveTool ? { confirmDestructiveTool } : undefined,
  )

  return { executor, gmail }
}

describe('toolExecutor HITL confirmation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('classifies every retained destructive tool and keeps safe/read-only tools unblocked', () => {
    const alwaysConfirmed = [
      'send_email',
      'reply_email',
      'create_draft_email',
      'archive_email',
      'delete_email',
      'star_email',
      'label_email',
      'create_calendar_event',
      'update_calendar_event',
      'delete_calendar_event',
      'create_contact',
      'create_drive_file',
      'delete_drive_file',
      'create_drive_folder',
      'export_clients_to_sheets',
      'export_projets_to_sheets',
      'wp_update_post',
      'wp_delete_post',
      'update_memory',
      'save_local_file',
      'delete_local_file',
      'create_app',
    ]

    for (const name of alwaysConfirmed) {
      expect(requiresDestructiveToolConfirmation(name, { status: 'draft' }), name).toBe(true)
    }

    expect(requiresDestructiveToolConfirmation('wp_create_post', { status: 'publish' })).toBe(true)
    expect(requiresDestructiveToolConfirmation('wp_create_post', { status: 'future' })).toBe(true)
    expect(requiresDestructiveToolConfirmation('wp_create_post', {})).toBe(true)
    expect(requiresDestructiveToolConfirmation('publish_wordpress', { status: 'publish' })).toBe(true)
    expect(requiresDestructiveToolConfirmation('publish_wordpress', {})).toBe(true)

    expect(requiresDestructiveToolConfirmation('wp_create_post', { status: 'draft' })).toBe(false)
    expect(requiresDestructiveToolConfirmation('wp_create_post', { status: ' DRAFT ' })).toBe(false)
    expect(requiresDestructiveToolConfirmation('read_emails')).toBe(false)
    expect(requiresDestructiveToolConfirmation('read_email')).toBe(false)
    expect(requiresDestructiveToolConfirmation('list_calendar')).toBe(false)
    expect(requiresDestructiveToolConfirmation('wp_list_posts')).toBe(false)
    expect(requiresDestructiveToolConfirmation('search_contacts')).toBe(false)
    expect(requiresDestructiveToolConfirmation('list_drive_files')).toBe(false)
    expect(requiresDestructiveToolConfirmation('open_app')).toBe(false)
    expect(requiresDestructiveToolConfirmation('screenshot_pc')).toBe(false)
  })

  it('builds an explicit confirmation message with the target action details', () => {
    const message = buildToolConfirmMessage('send_email', {
      to: 'victim@example.com',
      subject: 'Urgent transfer',
      body: 'secret',
    })

    expect(message).toContain('Confirmation requise')
    expect(message).toContain('victim@example.com')
    expect(message).toContain('Urgent transfer')
    expect(message).toContain('Confirme uniquement')
  })

  it('blocks a compromised model direct send_email tool-call when the user refuses', async () => {
    const confirm = vi.fn<ConfirmFn>().mockResolvedValue(false)
    const { executor, gmail } = createHarness(confirm)

    const result = await executor('send_email', {
      to: 'attacker@example.com',
      subject: 'Exfiltration',
      body: 'Send secrets',
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({ name: 'send_email' })
    expect(confirm.mock.calls[0]?.[0].message).toContain('attacker@example.com')
    expect(gmail.sendEmail).not.toHaveBeenCalled()
    expect(result.result).toMatch(/Action annulée/i)
  })

  it('executes a destructive tool only after explicit confirmation', async () => {
    const confirm = vi.fn<ConfirmFn>().mockResolvedValue(true)
    const { executor, gmail } = createHarness(confirm)

    const result = await executor('send_email', {
      to: 'client@example.com',
      subject: 'Compte rendu',
      body: 'Bonjour',
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(gmail.sendEmail).toHaveBeenCalledWith({
      to: 'client@example.com',
      subject: 'Compte rendu',
      body: 'Bonjour',
    })
    expect(result.result).toContain('Email envoyé')
  })

  it('blocks by default when no confirmation UI is available', async () => {
    const originalConfirm = window.confirm
    Object.defineProperty(window, 'confirm', { value: undefined, configurable: true })
    const { executor, gmail } = createHarness()

    const result = await executor('send_email', {
      to: 'attacker@example.com',
      subject: 'No UI bypass',
      body: 'Should not send',
    })

    expect(gmail.sendEmail).not.toHaveBeenCalled()
    expect(result.result).toMatch(/confirmation utilisateur requise/i)
    Object.defineProperty(window, 'confirm', { value: originalConfirm, configurable: true })
  })

  it('treats confirmation callback failures as denial, not as approval', async () => {
    const confirm = vi.fn<ConfirmFn>().mockRejectedValue(new Error('modal failed'))
    const { executor, gmail } = createHarness(confirm)

    const result = await executor('reply_email', {
      to: 'attacker@example.com',
      subject: 'Re: invoice',
      body: 'Malicious reply',
      thread_id: 'thread-x',
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(gmail.sendEmail).not.toHaveBeenCalled()
    expect(result.result).toMatch(/Action annulée/i)
  })

  it('does not ask for confirmation or regress normal read-only tool use', async () => {
    const confirm = vi.fn<ConfirmFn>().mockResolvedValue(false)
    const { executor, gmail } = createHarness(confirm)

    const result = await executor('read_emails', {})

    expect(confirm).not.toHaveBeenCalled()
    expect(gmail.sendEmail).not.toHaveBeenCalled()
    expect(result.result).toContain('alice@example.com')
    expect(result.result).toContain('Hello')
  })

  it('covers confirmation summaries for every sensitive action family', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['reply_email', { to: 'bob@example.com', thread_id: 't1', subject: 'Re' }, 'Répondre à bob@example.com'],
      ['create_draft_email', { to: 'draft@example.com', subject: 'Draft' }, 'brouillon Gmail'],
      ['archive_email', { message_id: 'm-archive' }, 'Archiver'],
      ['delete_email', { message_id: 'm-delete' }, 'Supprimer'],
      ['star_email', { message_id: 'm-star' }, 'important/étoilé'],
      ['label_email', { message_id: 'm-label', label: 'IMPORTANT' }, 'IMPORTANT'],
      ['create_calendar_event', { title: 'RDV client', start: '2026-07-01T10:00:00' }, 'Créer'],
      ['update_calendar_event', { event_id: 'evt-1' }, 'Modifier'],
      ['delete_calendar_event', { event_id: 'evt-2' }, 'Supprimer'],
      ['create_contact', { name: 'Alice', email: 'a@example.com' }, 'contact Google'],
      ['create_drive_file', { name: 'Secret.txt' }, 'Google Drive'],
      ['delete_drive_file', { file_id: 'drive-1' }, 'drive-1'],
      ['create_drive_folder', { name: 'Exports' }, 'Exports'],
      ['export_clients_to_sheets', { title: 'Clients export' }, 'mémoire clients'],
      ['export_projets_to_sheets', { title: 'Projets export' }, 'mémoire projets'],
      ['wp_create_post', { title: 'Post', status: 'future' }, 'WordPress'],
      ['publish_wordpress', { title: 'Legacy', status: 'publish' }, 'Publier'],
      ['wp_update_post', { post_id: 42 }, 'inchangé'],
      ['wp_delete_post', { post_id: 42 }, 'Supprimer'],
      ['update_memory', { category: 'profil' }, 'mémoire'],
      ['save_local_file', { path: 'new.pdf' }, 'Écrire'],
      ['delete_local_file', { path: 'old.pdf' }, 'fichier local'],
      ['create_app', { app: 'excel', filename: 'budget.xlsx' }, 'budget.xlsx'],
      ['custom_sensitive', { nested: { a: true } }, 'custom_sensitive'],
    ]

    for (const [name, input, expected] of cases) {
      expect(buildToolConfirmMessage(name, input), name).toContain(expected)
    }
  })

  it('keeps confirmation summaries bounded and robust for malformed inputs', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const fallback = buildToolConfirmMessage('custom_sensitive', circular)
    expect(fallback).toContain('[paramètres illisibles]')

    const long = buildToolConfirmMessage('send_email', {
      to: ` ${'a'.repeat(160)}@example.com `,
      subject: '',
    })
    expect(long).toContain('…')
    expect(long).toContain('non précisé')
  })

  it('uses browser confirm as a fallback UI and executes only when it returns true', async () => {
    const confirmSpy = vi.fn().mockReturnValue(true)
    Object.defineProperty(window, 'confirm', { value: confirmSpy, configurable: true })
    const { executor, gmail } = createHarness()

    const result = await executor('send_email', {
      to: 'client@example.com',
      subject: 'Fallback UI',
      body: 'Bonjour',
    })

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0]?.[0]).toContain('client@example.com')
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1)
    expect(result.result).toContain('Email envoyé')
  })

  it('returns a controlled error for unknown tools and handler failures', async () => {
    const { executor, gmail } = createHarness(() => true)

    await expect(executor('unknown_tool', {})).resolves.toEqual({ result: 'Outil inconnu: unknown_tool' })

    gmail.fetchMessages.mockRejectedValueOnce(new Error('gmail down'))
    const result = await executor('read_emails', {})
    expect(result.result).toBe('Erreur: gmail down')
  })

})
