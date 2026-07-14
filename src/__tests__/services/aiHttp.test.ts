import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: vi.fn() }))
vi.mock('../../services/emailTrialClient', () => ({ getTrialToken: vi.fn() }))

import { buildAiHeaders, fetchWithTimeout, readWithInactivityTimeout } from '../../services/aiHttp'
import { getValidAccessToken } from '../../services/googleAuth'
import { getTrialToken } from '../../services/emailTrialClient'

const mockGoogle = getValidAccessToken as unknown as Mock
const mockTrial = getTrialToken as unknown as Mock

beforeEach(() => {
  mockGoogle.mockReset(); mockTrial.mockReset()
  mockGoogle.mockResolvedValue('gtok'); mockTrial.mockReturnValue(null)
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

  it('le Stop utilisateur reste actif PENDANT la lecture du body (post-headers)', async () => {
    // Durcissement 14 juillet 2026 — l'ancien finally détachait le listener
    // du signal externe dès l'arrivée des headers : le Stop utilisateur ne
    // pouvait plus annuler le stream en cours de lecture (Mistral/Gemini).
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal ?? undefined
      return new Response('ok')
    }))
    const ext = new AbortController()
    await fetchWithTimeout('https://x', {}, 1000, ext.signal)
    expect(capturedSignal!.aborted).toBe(false)
    ext.abort(new DOMException('user', 'AbortError'))
    expect(capturedSignal!.aborted).toBe(true)
  })
})

describe('readWithInactivityTimeout (durcissement 14 juillet 2026)', () => {
  it('résout normalement quand des octets arrivent avant le délai', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data'))
      },
    })
    const reader = stream.getReader()
    const { done, value } = await readWithInactivityTimeout(reader, 1000)
    expect(done).toBe(false)
    expect(new TextDecoder().decode(value)).toBe('data')
  })

  it('rejette avec une Error ORDINAIRE (jamais AbortError) après le silence', async () => {
    // Connexion half-open simulée : aucun octet, jamais de close. Un
    // AbortError serait avalé par les catch des clients (Stop utilisateur)
    // → le spinner éternel reviendrait.
    const stream = new ReadableStream<Uint8Array>({ start() { /* silence */ } })
    const reader = stream.getReader()
    const promise = readWithInactivityTimeout(reader, 30)
    await expect(promise).rejects.toThrow()
    await expect(promise).rejects.not.toMatchObject({ name: 'AbortError' })
  })
})
