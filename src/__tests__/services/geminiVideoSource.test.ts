import { afterEach, describe, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../services/aiHttp', () => ({ buildAiHeaders: vi.fn(async () => ({})), fetchWithTimeout: mocked.fetch }))
vi.mock('../../services/activeApiKey', () => ({ getGeminiKey: () => null }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: vi.fn(async () => '') }))
vi.mock('../../services/trialClient', () => ({ updateTrialFromResponse: vi.fn() }))
vi.mock('../../services/modelLabels', () => ({ createModelReporter: () => vi.fn(), validModelId: () => false }))
import { streamGeminiMessage } from '../../services/geminiClient'
afterEach(() => vi.clearAllMocks())
describe('native video input authority', () => {
  it.each([false, true])('uses only original user URLs, authorized=%s', async authorized => {
    mocked.fetch.mockResolvedValue(Response.json({ error: 'synthetic error after request capture' }, { status: 400 }))
    const youtube = 'https://youtu.be/abcdefghijk'
    await new Promise<void>(resolve => {
      streamGeminiMessage([{ role: 'user', content: `TikTok analysis containing ${youtube}` }], vi.fn(), resolve, () => resolve(), {
        videoSourceText: authorized ? youtube : 'https://vm.tiktok.com/ZN8jJBpVS/', conversationId: 'synthetic',
      })
    })
    const body = JSON.parse(mocked.fetch.mock.calls[0]![1].body)
    const parts = body.contents[0].parts
    expect(parts.filter((p: { fileData?: unknown }) => p.fileData)).toHaveLength(authorized ? 1 : 0)
  })
})
