import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const authState = vi.hoisted(() => ({
  session: null as null | { userId: string; authMethod: 'google' | 'email' | 'apikey' },
  epoch: 0,
  storageReady: true,
  storedTokens: null as object | null,
}))

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(),
  getStoredTokens: () => authState.storedTokens,
  isGoogleStorageReady: () => authState.storageReady,
}))
vi.mock('../../services/emailTrialClient', () => ({ getTrialToken: vi.fn() }))
vi.mock('../../services/userSession', () => ({
  getActiveSession: () => authState.session,
  getActiveUserId: () => authState.session?.userId ?? null,
  getActiveSessionEpoch: () => authState.epoch,
}))

import { buildAiHeaders, fetchWithTimeout } from '../../services/aiHttp'
import { getValidAccessToken } from '../../services/googleAuth'
import { getTrialToken } from '../../services/emailTrialClient'

const mockGoogle = getValidAccessToken as unknown as Mock
const mockTrial = getTrialToken as unknown as Mock

beforeEach(() => {
  mockGoogle.mockReset(); mockTrial.mockReset()
  mockGoogle.mockResolvedValue('gtok'); mockTrial.mockReturnValue(null)
  authState.session = null
  authState.epoch = 0
  authState.storageReady = true
  authState.storedTokens = null
})
afterEach(() => vi.unstubAllGlobals())

describe('buildAiHeaders — trio factorisé (C9/F-20)', () => {
  it('clé BYOK réelle en Bearer + x-google-token frais', async () => {
    const h = await buildAiHeaders({ byokKey: 'sk-real', auth: 'bearer' })
    expect(h['Authorization']).toBe('Bearer sk-real')
    expect(h['x-google-token']).toBe('gtok')
    expect(h['Content-Type']).toBe('application/json')
  })

  it('auth x-api-key (Anthropic) + extra headers fusionnés', async () => {
    const h = await buildAiHeaders({ byokKey: 'sk-ant', auth: 'x-api-key', extra: { 'anthropic-version': '2023-06-01' } })
    expect(h['x-api-key']).toBe('sk-ant')
    expect(h['Authorization']).toBeUndefined()
    expect(h['anthropic-version']).toBe('2023-06-01')
  })

  it("NE JAMAIS envoyer la sentinelle 'server-provided' comme clé (BUG 25)", async () => {
    const h = await buildAiHeaders({ byokKey: 'server-provided', auth: 'bearer' })
    expect(h['Authorization']).toBeUndefined()
    expect(h['x-api-key']).toBeUndefined()
    expect(h['x-google-token']).toBe('gtok') // le token Google reste envoyé
  })

  it('sans clé BYOK → aucun header de clé', async () => {
    const h = await buildAiHeaders()
    expect(h['Authorization']).toBeUndefined()
    expect(h['x-api-key']).toBeUndefined()
  })

  it('pas de token Google → repli jeton d’essai (x-arty-trial-token)', async () => {
    mockGoogle.mockResolvedValue(null)
    mockTrial.mockReturnValue('trial-123')
    const h = await buildAiHeaders({ byokKey: 'sk', auth: 'bearer' })
    expect(h['x-google-token']).toBeUndefined()
    expect(h['x-arty-trial-token']).toBe('trial-123')
  })

  it('ni Google ni trial → aucun en-tête d’auth serveur', async () => {
    mockGoogle.mockResolvedValue(null); mockTrial.mockReturnValue(null)
    const h = await buildAiHeaders()
    expect(h['x-google-token']).toBeUndefined()
    expect(h['x-arty-trial-token']).toBeUndefined()
  })

  it('session Google sans grant : refuse avant tout fallback email-trial', async () => {
    authState.session = { userId: 'google-a', authMethod: 'google' }
    authState.storedTokens = null
    mockGoogle.mockResolvedValue(null)
    mockTrial.mockReturnValue('trial-ne-doit-pas-fuir')

    await expect(buildAiHeaders()).rejects.toThrow(/reconnect Google/i)
    expect(mockTrial).not.toHaveBeenCalled()
  })

  it('cold boot Google : attend le déchiffrement puis joint le grant', async () => {
    authState.session = { userId: 'google-a', authMethod: 'google' }
    authState.storageReady = false
    mockGoogle.mockResolvedValue('fresh-after-bootstrap')
    mockTrial.mockReturnValue('trial-ne-doit-pas-fuir')

    const pending = buildAiHeaders()
    await Promise.resolve()
    authState.storageReady = true
    window.dispatchEvent(new CustomEvent('google-storage-ready'))

    await expect(pending).resolves.toMatchObject({
      'x-google-token': 'fresh-after-bootstrap',
    })
    expect(mockTrial).not.toHaveBeenCalled()
  })

  it.each(['email', 'apikey'] as const)(
    'cold boot %s avec intégration Google : attend aussi le grant lié',
    async (authMethod) => {
      authState.session = { userId: `${authMethod}-a`, authMethod }
      authState.storageReady = false
      mockGoogle.mockResolvedValue('linked-google-after-bootstrap')
      mockTrial.mockReturnValue('trial-ne-doit-pas-gagner')

      const pending = buildAiHeaders({ byokKey: authMethod === 'apikey' ? 'sk-byok' : undefined })
      await Promise.resolve()
      expect(mockGoogle).not.toHaveBeenCalled()
      authState.storageReady = true
      window.dispatchEvent(new CustomEvent('google-storage-ready'))

      await expect(pending).resolves.toMatchObject({
        'x-google-token': 'linked-google-after-bootstrap',
      })
      expect(mockTrial).not.toHaveBeenCalled()
    },
  )

  it('changement d’époque pendant le refresh : aucun ancien token n’est retourné', async () => {
    authState.session = { userId: 'google-a', authMethod: 'google' }
    let resolveToken!: (token: string) => void
    mockGoogle.mockReturnValue(new Promise<string>((resolve) => { resolveToken = resolve }))

    const pending = buildAiHeaders()
    authState.epoch += 1
    resolveToken('stale-token')

    await expect(pending).rejects.toThrow(/session changed/i)
  })

  it('Content-Type reste présent quand des extra sont fournis', async () => {
    const h = await buildAiHeaders({ extra: { 'anthropic-version': '2023-06-01' } })
    expect(h['Content-Type']).toBe('application/json')
    expect(h['anthropic-version']).toBe('2023-06-01')
  })

  it('extra NE PEUT PAS écraser la clé BYOK (posée après le spread)', async () => {
    const h = await buildAiHeaders({
      byokKey: 'sk-real',
      auth: 'bearer',
      extra: { Authorization: 'Bearer HACKED' },
    })
    expect(h['Authorization']).toBe('Bearer sk-real')
  })
})

describe('fetchWithTimeout (C9/F-20)', () => {
  it('retourne la réponse quand le fetch aboutit avant le timeout', async () => {
    const resp = new Response('ok', { status: 200 })
    vi.stubGlobal('fetch', vi.fn(async () => resp))
    const r = await fetchWithTimeout('https://x', { method: 'POST' }, 1000)
    expect(r).toBe(resp)
  })

  it('abort sur dépassement du timeout (AbortError)', async () => {
    // fetch qui ne se résout jamais tant que le signal n'est pas abort
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(init.signal!.reason))
      }),
    ))
    await expect(fetchWithTimeout('https://x', { method: 'GET' }, 10)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('propage l’abort d’un signal externe déjà annulé', async () => {
    const ext = new AbortController()
    ext.abort(new DOMException('user', 'AbortError'))
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        if (init.signal?.aborted) rej(init.signal.reason)
        else init.signal?.addEventListener('abort', () => rej(init.signal!.reason))
      }),
    ))
    await expect(fetchWithTimeout('https://x', {}, 5000, ext.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
