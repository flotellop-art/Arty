import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ activeUserId: 'account-b' as string | null, sessionEpoch: 2 }))

vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => mocks.activeUserId,
  getActiveSessionEpoch: () => mocks.sessionEpoch,
}))

import { sendMessageStream } from '../../services/openaiClient'

describe('openaiClient — scope compte des opérations vision', () => {
  it('bloque avant fetch si le compte actif ne possède plus les pixels', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const error = await new Promise<Error>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('timeout')), 2_000)
      sendMessageStream(
        [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==', detail: 'original' } },
          { type: 'text', text: 'Locate.' },
        ] }],
        'sk-account-a',
        () => undefined,
        () => reject(new Error('unexpected completion')),
        (received) => {
          window.clearTimeout(timeout)
          resolve(received)
        },
        { expectedUserId: 'account-a', expectedSessionEpoch: 1, maxCompletionTokens: 32 },
      )
    })

    expect(error.message).toBeTruthy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
