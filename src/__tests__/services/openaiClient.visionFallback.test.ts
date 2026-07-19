import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  sendMessageStream,
  type OpenAIMessage,
} from '../../services/openaiClient'

const ORIGINAL_FETCH = global.fetch

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

function run(messages: OpenAIMessage[]): Promise<Error | null> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('timeout')), 2000)
    sendMessageStream(
      messages,
      'sk-user',
      () => undefined,
      () => { window.clearTimeout(timeout); resolve(null) },
      (error) => { window.clearTimeout(timeout); resolve(error) },
    )
  })
}

describe('openaiClient — fallback vision', () => {
  it("n'envoie qu'une requête si Terra refuse un payload image", async () => {
    const fetchMock = vi.fn(async () => Response.json(
      { error: { message: 'model does not exist' } },
      { status: 400 },
    ))
    global.fetch = fetchMock as typeof fetch

    const error = await run([{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==', detail: 'original' } },
        { type: 'text', text: 'Analyse.' },
      ],
    }])
    expect(error).toBeInstanceOf(Error)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('conserve le fallback historique Terra vers gpt-5 pour le texte', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(
        { error: { message: 'model does not exist' } },
        { status: 400 },
      ))
      .mockResolvedValueOnce(Response.json(
        { error: { message: 'invalid request' } },
        { status: 400 },
      ))
    global.fetch = fetchMock as typeof fetch

    const error = await run([{ role: 'user', content: 'Bonjour' }])
    expect(error).toBeInstanceOf(Error)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { model: string }
    expect(secondBody.model).toBe('gpt-5')
  })
})
