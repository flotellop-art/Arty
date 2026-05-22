import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/gmailClient', () => ({
  listUnreadEmails: vi.fn().mockResolvedValue([{ id: '1', from: 'sender@test.com', subject: 'Subject' }]),
}))
vi.mock('../../services/calendarClient', () => ({
  listEvents: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../services/native/location', () => ({
  isLocationConsentEnabled: () => false,
  getUserLocation: () => null,
}))
vi.mock('../../services/apiBase', () => ({
  apiUrl: (path: string) => path,
}))

describe('Restricted Features Gating', () => {
  beforeEach(() => {
    vi.resetModules()
    import.meta.env.VITE_GOOGLE_CLIENT_ID = 'test-client-id'
  })

  it('when ENABLE_RESTRICTED_GOOGLE_FEATURES is false', async () => {
    vi.doMock('../../config', () => ({
      ENABLE_RESTRICTED_GOOGLE_FEATURES: false,
    }))

    const { buildOAuthUrl } = await import('../../services/googleAuth')
    const { TOOLS } = await import('../../services/toolDefinitions')
    const { createToolExecutor } = await import('../../services/toolExecutor')
    const { buildBriefSpeechText } = await import('../../services/morningBriefService')
    const { listUnreadEmails } = await import('../../services/gmailClient')

    // 1. Check OAuth URL scopes
    const url = buildOAuthUrl()
    const parsedUrl = new URL(url)
    const scope = parsedUrl.searchParams.get('scope') || ''
    
    expect(scope).not.toContain('gmail.readonly')
    expect(scope).not.toContain('gmail.modify')
    expect(scope).not.toContain('drive')
    expect(scope).toContain('gmail.send')
    expect(scope).toContain('calendar')

    // 2. Check TOOLS
    const toolNames = TOOLS.map(t => t.name)
    expect(toolNames).not.toContain('read_emails')
    expect(toolNames).not.toContain('list_drive')
    expect(toolNames).not.toContain('export_clients_to_sheets')
    expect(toolNames).toContain('send_email')

    // 3. Check executor safety gate
    const dummyComputer = {} as any
    const dummyGmail = {} as any
    const dummyDrive = {} as any
    const dummyBrowser = {} as any
    const execute = createToolExecutor(dummyComputer, dummyGmail, dummyDrive, dummyBrowser)
    
    const result1 = await execute('read_emails', {})
    expect(result1.result).toContain("Outil indisponible dans cette version d'Arty")

    const result2 = await execute('list_drive', {})
    expect(result2.result).toContain("Outil indisponible dans cette version d'Arty")

    const result3 = await execute('export_clients_to_sheets', {})
    expect(result3.result).toContain("Outil indisponible dans cette version d'Arty")

    // 4. Verify Morning Brief does not load unread emails
    vi.mocked(listUnreadEmails).mockClear()
    const brief = await buildBriefSpeechText('John Doe', true)
    expect(listUnreadEmails).not.toHaveBeenCalled()
    expect(brief).not.toContain('sender@test.com')
  })

  it('when ENABLE_RESTRICTED_GOOGLE_FEATURES is true', async () => {
    vi.doMock('../../config', () => ({
      ENABLE_RESTRICTED_GOOGLE_FEATURES: true,
    }))

    const { buildOAuthUrl } = await import('../../services/googleAuth')
    const { TOOLS } = await import('../../services/toolDefinitions')
    const { buildBriefSpeechText } = await import('../../services/morningBriefService')
    const { listUnreadEmails } = await import('../../services/gmailClient')

    // 1. Check OAuth URL scopes
    const url = buildOAuthUrl()
    const parsedUrl = new URL(url)
    const scope = parsedUrl.searchParams.get('scope') || ''
    
    expect(scope).toContain('gmail.readonly')
    expect(scope).toContain('gmail.modify')
    expect(scope).toContain('drive')

    // 2. Check TOOLS
    const toolNames = TOOLS.map(t => t.name)
    expect(toolNames).toContain('read_emails')
    expect(toolNames).toContain('list_drive')
    expect(toolNames).toContain('export_clients_to_sheets')

    // 3. Verify Morning Brief loads unread emails
    vi.mocked(listUnreadEmails).mockClear()
    const brief = await buildBriefSpeechText('John Doe', true)
    expect(listUnreadEmails).toHaveBeenCalled()
    expect(brief).toContain('sender@test.com')
  })
})
