import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/apiBase', () => ({ apiUrl: (p: string) => p }))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.resetModules()
})

// ───────────────────────────────────────────────────────────────────────────
// M-7 — la migration multi-compte ne détruit PLUS le sel crypto global
// (régression : avant le fix, ajouter un 2e compte rendait illisibles les
// données chiffrées du 1er). Fix = retrait de 'crypto-salt'/'crypto-check' de
// LEGACY_KEYS (userSession.ts).
// ───────────────────────────────────────────────────────────────────────────
describe('M-7 — crypto salt survives multi-account migration', () => {
  it('global salt is preserved when a 2nd account migrates, 1st account data stays decryptable', async () => {
    const crypto = await import('../../services/crypto')
    const { migrateExistingData } = await import('../../services/userSession')

    await crypto.initCrypto('server-provided')
    const blob = await crypto.encrypt('A-refresh-token')
    expect(await crypto.decrypt(blob)).toBe('A-refresh-token')

    // Ajout d'un 2e compte → sa migration NE doit plus toucher le sel global.
    migrateExistingData('google-bbbb')
    expect(localStorage.getItem('arty-crypto-salt')).toBeTruthy()
    expect(localStorage.getItem('arty-google-bbbb-crypto-salt')).toBeNull()

    // Reboot : le sel global est intact → la donnée du 1er compte reste lisible.
    vi.resetModules()
    const cryptoFresh = await import('../../services/crypto')
    await cryptoFresh.initCrypto('server-provided')
    expect(await cryptoFresh.decrypt(blob)).toBe('A-refresh-token')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// N-1 / M-3 — validation d'audience du gate
// ───────────────────────────────────────────────────────────────────────────
describe('N-1 / M-3 — Google token audience validation', () => {
  // Route le mock fetch selon l'URL (userinfo vs tokeninfo).
  function routeFetch(routes: { userinfo?: unknown; tokeninfo?: unknown; userinfoOk?: boolean; tokeninfoOk?: boolean }) {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('userinfo')) {
        return { ok: routes.userinfoOk ?? true, status: 200, json: async () => routes.userinfo ?? {} } as unknown as Response
      }
      if (u.includes('tokeninfo')) {
        return { ok: routes.tokeninfoOk ?? true, status: 200, json: async () => routes.tokeninfo ?? {} } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch
  }

  function req() {
    return new Request('https://arty/api/ai/proxy', {
      method: 'POST',
      headers: { 'x-google-token': 'tok' },
    })
  }

  it('N-1: rejects a token with an explicit FOREIGN aud when expectedAud is set', async () => {
    const { verifyGoogleUser } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ userinfo: { email: 'x@y.z' }, tokeninfo: { aud: 'OTHER_APP', azp: 'OTHER_APP' } })
    expect(await verifyGoogleUser(req(), 'MY_CLIENT_ID')).toBeNull()
  })

  it('N-1: accepts a token whose aud matches expectedAud', async () => {
    const { verifyGoogleUser } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ userinfo: { email: 'x@y.z' }, tokeninfo: { aud: 'MY_CLIENT_ID' } })
    expect(await verifyGoogleUser(req(), 'MY_CLIENT_ID')).toBe('x@y.z')
  })

  it('N-1: accepts a token whose azp matches expectedAud (native serverAuthCode case)', async () => {
    const { verifyGoogleUser } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ userinfo: { email: 'x@y.z' }, tokeninfo: { aud: 'OTHER', azp: 'MY_CLIENT_ID' } })
    expect(await verifyGoogleUser(req(), 'MY_CLIENT_ID')).toBe('x@y.z')
  })

  it('N-1 fail-safe: does NOT lock out when tokeninfo fails (transient) — keeps email', async () => {
    const { verifyGoogleUser } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ userinfo: { email: 'x@y.z' }, tokeninfoOk: false })
    expect(await verifyGoogleUser(req(), 'MY_CLIENT_ID')).toBe('x@y.z')
  })

  it('N-1 fail-safe: does NOT lock out when aud/azp are absent — keeps email', async () => {
    const { verifyGoogleUser } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ userinfo: { email: 'x@y.z' }, tokeninfo: {} })
    expect(await verifyGoogleUser(req(), 'MY_CLIENT_ID')).toBe('x@y.z')
  })

  it('no expectedAud (Google data endpoints) → userinfo only, no audience check', async () => {
    const { verifyGoogleUser } = await import('../../../functions/api/_lib/checkAllowedUser')
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ email: 'x@y.z' }) } as unknown as Response))
    global.fetch = f as unknown as typeof fetch
    expect(await verifyGoogleUser(req())).toBe('x@y.z')
    // un seul appel (userinfo), jamais tokeninfo
    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0]?.[0])).toContain('userinfo')
  })

  it('M-3: verifyTokenViaTokeninfo rejects a token with NO aud when expectedAud is set', async () => {
    const { verifyTokenViaTokeninfo } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ tokeninfo: { email: 'x@y.z', email_verified: 'true' } })
    expect(await verifyTokenViaTokeninfo('tok', 'MY_CLIENT_ID')).toBeNull()
  })

  it('M-3: verifyTokenViaTokeninfo accepts a matching aud', async () => {
    const { verifyTokenViaTokeninfo } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ tokeninfo: { email: 'x@y.z', email_verified: 'true', aud: 'MY_CLIENT_ID' } })
    expect(await verifyTokenViaTokeninfo('tok', 'MY_CLIENT_ID')).toBe('x@y.z')
  })

  it('strict gate fails closed when GOOGLE_CLIENT_ID is missing', async () => {
    const { verifyGoogleUserStrict } = await import('../../../functions/api/_lib/checkAllowedUser')
    const f = vi.fn()
    global.fetch = f as unknown as typeof fetch
    expect(await verifyGoogleUserStrict(req(), undefined)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('strict gate rejects a foreign audience before reading userinfo', async () => {
    const { verifyGoogleUserStrict } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({ tokeninfo: { aud: 'OTHER_APP', azp: 'OTHER_APP' } })
    expect(await verifyGoogleUserStrict(req(), 'MY_CLIENT_ID')).toBeNull()
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('strict gate returns the verified Arty identity for matching aud/azp', async () => {
    const { verifyGoogleIdentityStrict } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({
      tokeninfo: { aud: 'MY_CLIENT_ID' },
      userinfo: { email: 'Owner@Example.com', id: 'google-sub-1', verified_email: true },
    })
    expect(await verifyGoogleIdentityStrict(req(), 'MY_CLIENT_ID')).toEqual({
      email: 'owner@example.com',
      sub: 'google-sub-1',
    })
  })

  it('strict gate rejects userinfo that does not confirm a verified email', async () => {
    const { verifyGoogleUserStrict } = await import('../../../functions/api/_lib/checkAllowedUser')
    routeFetch({
      tokeninfo: { aud: 'MY_CLIENT_ID' },
      userinfo: { email: 'owner@example.com', id: 'google-sub-1' },
    })
    expect(await verifyGoogleUserStrict(req(), 'MY_CLIENT_ID')).toBeNull()
  })

  it('purges ownerless legacy reports instead of assigning them to the next account', async () => {
    const { migrateExistingData } = await import('../../services/userSession')

    localStorage.setItem('arty-report-privatelegacy', '<html>other user report</html>')
    localStorage.setItem('arty-conversations', JSON.stringify([{ id: 'legacy-conversation' }]))

    migrateExistingData('google-new-owner')

    expect(localStorage.getItem('arty-report-privatelegacy')).toBeNull()
    expect(localStorage.getItem('arty-google-new-owner-report-privatelegacy')).toBeNull()
    // Other ownerless data keeps its established migration path.
    expect(localStorage.getItem('arty-google-new-owner-conversations')).toContain('legacy-conversation')

    // Purging happens even when this account's migration flag already exists.
    localStorage.setItem('arty-report-restoredlater', '<html>restored report</html>')
    migrateExistingData('google-new-owner')
    expect(localStorage.getItem('arty-report-restoredlater')).toBeNull()
  })
})
