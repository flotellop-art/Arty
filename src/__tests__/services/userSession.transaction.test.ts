import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('userSession — publication transactionnelle', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('garde une session provisoire en mémoire jusqu’au commit explicite', async () => {
    const sessions = await import('../../services/userSession')
    const session = {
      userId: 'google-user-a',
      authMethod: 'google' as const,
      displayName: 'User A',
      email: 'user@example.com',
      createdAt: 1,
    }

    sessions.setActiveSession(session, { remember: false })

    expect(sessions.getActiveSession()).toEqual(session)
    expect(localStorage.getItem('arty-active-session')).toBeNull()
    expect(sessions.getKnownSessions()).toEqual([])

    sessions.rememberSession(session)

    expect(JSON.parse(localStorage.getItem('arty-active-session') || 'null')).toEqual(session)
    expect(sessions.getKnownSessions()).toEqual([session])
  })
})
