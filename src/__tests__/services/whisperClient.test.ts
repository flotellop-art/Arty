// Renforcement EU — routage de la transcription vocale : une conversation
// euOnly ne doit JAMAIS envoyer l'audio chez OpenAI (US). La dictée EU passe
// par le proxy Voxtral (Mistral, France).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../services/googleAuth', () => ({
  getValidAccessToken: vi.fn(async () => 'g-token'),
}))

import { transcribeAudio } from '../../services/whisperClient'
import { setActiveKeys, clearActiveKeys } from '../../services/activeApiKey'

const fetchMock = vi.fn(async () =>
  new Response(JSON.stringify({ text: 'salut' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
)

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
  return { url: String(call[0]), init: call[1] }
}

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  clearActiveKeys()
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearActiveKeys()
})

describe('transcribeAudio — routage EU/US', () => {
  const blob = new Blob(['fake-audio'], { type: 'audio/webm' })

  it('euOnly route vers le proxy Voxtral, jamais OpenAI', async () => {
    const text = await transcribeAudio(blob, { euOnly: true })
    expect(text).toBe('salut')

    const { url, init } = lastCall()
    expect(url).toContain('/api/ai/voxtral-proxy')
    expect(url).not.toContain('openai.com')
    expect((init.headers as Record<string, string>)['x-google-token']).toBe('g-token')

    const form = init.body as FormData
    expect(form.get('model')).toBe('voxtral-mini-latest')
    // verbose_json est un champ OpenAI — ne doit pas partir chez Mistral.
    expect(form.get('response_format')).toBeNull()
  })

  it('euOnly + BYOK Mistral forwarde la clé en Bearer (via le proxy quand même)', async () => {
    setActiveKeys('anthropic-key', undefined, 'mistral-byok')
    await transcribeAudio(blob, { euOnly: true })

    const { url, init } = lastCall()
    expect(url).toContain('/api/ai/voxtral-proxy')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer mistral-byok')
  })

  it('hors EU avec BYOK OpenAI : appel direct OpenAI (comportement historique)', async () => {
    setActiveKeys('anthropic-key', undefined, undefined, 'openai-byok')
    await transcribeAudio(blob)

    const { url, init } = lastCall()
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    const form = init.body as FormData
    expect(form.get('response_format')).toBe('verbose_json')
  })

  it('hors EU sans BYOK : proxy Whisper avec token Google', async () => {
    await transcribeAudio(blob)

    const { url, init } = lastCall()
    expect(url).toContain('/api/ai/whisper-proxy')
    expect((init.headers as Record<string, string>)['x-google-token']).toBe('g-token')
  })
})
