import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { buildBriefSpeechText } from '../../services/morningBriefService'
import { getUserLocation } from '../../services/native/location'
import { resetCalendarFixture, relinkCalendarGoogle } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/native/location', () => ({ isLocationConsentEnabled: () => true, getUserLocation: vi.fn(async () => null) }))
beforeEach(async () => { await resetCalendarFixture(); vi.mocked(getUserLocation).mockResolvedValue(null) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('Morning speech captures Calendar before geolocation/weather waits', () => {
  it('does not bind B after location for A resolves late', async () => {
    const location = deferred<null>()
    vi.mocked(getUserLocation).mockReturnValueOnce(location.promise)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const outcome = buildBriefSpeechText('Synthetic', true).catch(error => error)
    await relinkCalendarGoogle('b'); location.resolve(null)
    expect(await outcome).toBeInstanceOf(Error); expect(fetcher).not.toHaveBeenCalled()
  })
  it('speaks unavailable instead of inventing an empty agenda after a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    expect(await buildBriefSpeechText('Synthetic', true)).toContain('Agenda indisponible')
  })
})
