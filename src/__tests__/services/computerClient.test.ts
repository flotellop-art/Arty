import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Le relay exige x-google-token ; sans lui il répond 404 et la feature est
// morte (MED-J). On garde une non-régression : le client DOIT forwarder le token.
vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => 'TESTTOKEN'),
}))
vi.mock('../../services/apiBase', () => ({
  apiUrl: (p: string) => `https://tryarty.com${p}`,
}))

import { sendComputerAction } from '../../services/computerClient'

let origFetch: typeof fetch
beforeEach(() => {
  origFetch = global.fetch
})
afterEach(() => {
  global.fetch = origFetch
  vi.restoreAllMocks()
})

describe('computerClient', () => {
  it('forwarde le token Google en header x-google-token vers le relay', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    } as unknown as Response))
    global.fetch = fetchMock as unknown as typeof fetch

    await sendComputerAction('screenshot')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const opts = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(opts.headers).toMatchObject({ 'x-google-token': 'TESTTOKEN' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://tryarty.com/api/computer/relay')
  })

  it('n’ajoute pas le header si aucun token (relay rejettera côté serveur)', async () => {
    const { getValidAccessToken } = await import('../../services/googleAuth')
    vi.mocked(getValidAccessToken).mockResolvedValueOnce(null as unknown as string)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    } as unknown as Response))
    global.fetch = fetchMock as unknown as typeof fetch

    await sendComputerAction('screenshot')

    const opts = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(opts.headers).not.toHaveProperty('x-google-token')
  })
})
