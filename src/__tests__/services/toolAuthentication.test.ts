import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(async (): Promise<string | null> => 'google-token'),
  callGoogleApi: vi.fn(async () => ({ id: 42, title: 'Article', status: 'draft' })),
}))
const { getValidAccessToken, callGoogleApi } = mocks

vi.mock('../../services/googleAuth', () => ({ getValidAccessToken: mocks.getValidAccessToken }))
vi.mock('../../services/native/location', () => ({
  getUserLocation: vi.fn(async () => null),
  isLocationConsentEnabled: vi.fn(() => false),
}))
vi.mock('../../services/googleApiHelper', () => ({ callGoogleApi: mocks.callGoogleApi }))

import { createUtilityHandlers } from '../../services/tools/utilityTools'
import { createWordpressHandlers } from '../../services/tools/wordpressTools'

describe('authentification des outils client → backend', () => {
  beforeEach(() => {
    getValidAccessToken.mockReset()
    getValidAccessToken.mockResolvedValue('google-token')
    callGoogleApi.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('joint le jeton Google à la requête météo', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        city: 'Paris',
        current: { condition: 'Clair', temperature: 20, wind: 5 },
        forecast: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    )
    vi.stubGlobal('fetch', fetchMock)

    await createUtilityHandlers().get_weather({ city: 'Paris' })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ 'x-google-token': 'google-token' })
  })

  it('n’appelle pas la météo protégée sans jeton Google', async () => {
    getValidAccessToken.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await createUtilityHandlers().get_weather({ city: 'Paris' })

    expect(result.result).toMatch(/connecte/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fait passer les opérations WordPress par le helper Google authentifié', async () => {
    await createWordpressHandlers().wp_create_post({
      title: 'Article',
      content: '<p>Texte</p>',
      status: 'draft',
    })

    expect(callGoogleApi).toHaveBeenCalledWith('/api/wordpress/action', expect.objectContaining({
      type: 'create',
      title: 'Article',
    }))
  })
})
