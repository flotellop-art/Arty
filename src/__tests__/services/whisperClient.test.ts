// Routage de la transcription vocale.
// - euOnly : Voxtral strict (Mistral, France), JAMAIS OpenAI, pas de fallback.
// - Défaut hors EU : Voxtral (clé serveur ou BYOK Mistral), filet de secours
//   Whisper sur incident Mistral (5xx/réseau) uniquement.
// - BYOK OpenAI sans clé Mistral : direct OpenAI (comportement historique).
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

  it('hors EU sans BYOK : Voxtral par défaut (clé serveur)', async () => {
    await transcribeAudio(blob)

    const { url, init } = lastCall()
    expect(url).toContain('/api/ai/voxtral-proxy')
    expect((init.headers as Record<string, string>)['x-google-token']).toBe('g-token')
  })

  it('hors EU avec BYOK Mistral : Voxtral sur SA clé (Bearer)', async () => {
    setActiveKeys('anthropic-key', undefined, 'mistral-byok')
    await transcribeAudio(blob)

    const { url, init } = lastCall()
    expect(url).toContain('/api/ai/voxtral-proxy')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer mistral-byok')
  })

  it('hors EU : incident Voxtral (502) → filet de secours proxy Whisper', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'Transcription failed' }), { status: 502 })
    )
    const text = await transcribeAudio(blob)
    expect(text).toBe('salut')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const { url } = lastCall()
    expect(url).toContain('/api/ai/whisper-proxy')
  })

  it('hors EU : erreur définitive Voxtral (429 quota) → surface, pas de fallback', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'Quota quotidien atteint' }), { status: 429 })
    )
    await expect(transcribeAudio(blob)).rejects.toThrow(/quota/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('euOnly : incident Voxtral (502) → AUCUN fallback US, erreur surfacée', async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ error: 'Transcription failed' }), { status: 502 })
    )
    await expect(transcribeAudio(blob, { euOnly: true })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(lastCall().url).not.toContain('whisper')
    expect(lastCall().url).not.toContain('openai')
  })
})
