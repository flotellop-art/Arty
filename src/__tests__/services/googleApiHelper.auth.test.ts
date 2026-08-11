import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  token: vi.fn(async () => 'google-token'),
}))

vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mocks.token }))

import { callGoogleApi } from '../../services/googleApiHelper'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('callGoogleApi — contrat des endpoints Google/WordPress', () => {
  it('joint le header Google dédié sans retirer le Bearer de pass-through', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(callGoogleApi('/api/wordpress/action', { type: 'list' })).resolves.toEqual({ ok: true })

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer google-token',
      'x-google-token': 'google-token',
    })
  })
})
