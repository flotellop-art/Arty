import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ model: vi.fn(), search: vi.fn() }))
vi.mock('../../services/aiHttp', () => ({ buildAiHeaders: vi.fn(async () => ({})), fetchWithTimeout: mocked.model }))
vi.mock('../../services/activeApiKey', () => ({ getGeminiKey: () => null }))
vi.mock('../../services/locationContext', () => ({ buildLocationContext: vi.fn(async () => '') }))
vi.mock('../../services/trialClient', () => ({ updateTrialFromResponse: vi.fn() }))
vi.mock('../../services/modelLabels', () => ({ createModelReporter: () => vi.fn(), validModelId: () => false }))
vi.mock('../../services/tools/clientWebSearch', () => ({ WEB_SEARCH_TOOL_DEF: { function: { parameters: {} } }, executeClientWebSearch: mocked.search }))
import { geminiResearch, streamGeminiMessage } from '../../services/geminiClient'
beforeEach(() => { vi.stubEnv('VITE_AUTONOMOUS_WEB', 'true'); vi.clearAllMocks() })
afterEach(() => vi.unstubAllEnvs())

describe('owned Gemini preparation, including hybrid', () => {
  it('Stop during index search prevents the model request', async () => {
    const ctrl = new AbortController()
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    mocked.search.mockImplementation((_args, _scope, signal) => new Promise((resolve) => {
      started(); signal.addEventListener('abort', () => resolve({ result: 'Erreur réseau' }), { once: true })
    }))
    const pending = geminiResearch('FTS5', undefined, undefined, 'test', undefined, ctrl.signal)
    await ready; ctrl.abort()
    await expect(pending).rejects.toThrow()
    expect(mocked.model).not.toHaveBeenCalled()
  })
  it('hybrid receives owned context without native tools, with cancellation forwarded', async () => {
    mocked.search.mockResolvedValue({ result: 'Corpus Arty: source https://www.sqlite.org/fts5.html' })
    mocked.model.mockResolvedValue(Response.json({ error: 'test response after capture' }, { status: 400 }))
    const ctrl = new AbortController()
    await geminiResearch('FTS5', undefined, undefined, 'test', undefined, ctrl.signal)
    const call = mocked.model.mock.calls[0]!
    const body = JSON.parse(call[1].body)
    expect(body.tools).toEqual([])
    expect(body.contents[0].parts[0].text).toContain('Corpus Arty')
    expect(call[3]).toBe(ctrl.signal)
  })
  it('maps chat also uses the corpus and declares no Google tool', async () => {
    mocked.search.mockResolvedValue({ result: 'Corpus Arty: Aucun résultat.' })
    mocked.model.mockResolvedValue(Response.json({ error: 'test capture' }, { status: 400 }))
    await new Promise<void>(resolve => streamGeminiMessage([{ role: 'user', content: 'itinéraire Paris Lyon' }], vi.fn(), resolve, () => resolve(), { videoSourceText: 'itinéraire Paris Lyon' }))
    const body = JSON.parse(mocked.model.mock.calls[0]![1].body)
    expect(body.tools).toBeUndefined()
    expect(mocked.search).toHaveBeenCalledOnce()
  })
})
