// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  OPENAI_CHAT_BODY_MAX_BYTES,
  OPENAI_TEXT_BODY_MAX_BYTES,
  limitReadableStream,
  observeReadableStreamCompletion,
  readRequestTextWithLimit,
  RequestBodyTooLargeError,
} from '../../../functions/api/_lib/boundedRequestBody'

function streamedRequest(chunks: string[], contentLength?: string): Request {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Request('https://tryarty.com/api/ai/openai-proxy', {
    method: 'POST',
    headers: contentLength ? { 'content-length': contentLength } : undefined,
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

function generatedAsciiRequest(totalBytes: number, chunkBytes = 1024 * 1024): Request {
  let remaining = totalBytes
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (remaining === 0) {
        controller.close()
        return
      }
      const size = Math.min(remaining, chunkBytes)
      remaining -= size
      controller.enqueue(new Uint8Array(size).fill(0x61))
    },
  })
  return new Request('https://tryarty.com/api/ai/openai-proxy', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
}

describe('readRequestTextWithLimit', () => {
  it('fixe le contrat OpenAI à 24 Mio binaires de JSON', () => {
    expect(OPENAI_CHAT_BODY_MAX_BYTES).toBe(24 * 1024 * 1024)
    expect(OPENAI_TEXT_BODY_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('accepte exactement N octets UTF-8', async () => {
    await expect(readRequestTextWithLimit(streamedRequest(['é', 'é']), 4)).resolves.toBe('éé')
  })

  it('accepte exactement 24 Mio en streaming sans matérialiser une string', async () => {
    const request = generatedAsciiRequest(OPENAI_CHAT_BODY_MAX_BYTES)
    const reader = limitReadableStream(request.body!, OPENAI_CHAT_BODY_MAX_BYTES).getReader()
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
    }
    expect(received).toBe(OPENAI_CHAT_BODY_MAX_BYTES)
  })

  it('rejette N+1 même sans Content-Length', async () => {
    await expect(readRequestTextWithLimit(streamedRequest(['123', '45']), 4))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })

  it('rejette un Content-Length supérieur avant de faire confiance au flux', async () => {
    await expect(readRequestTextWithLimit(streamedRequest(['ok'], '5'), 4))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })

  it('rejette un flux sous-déclaré qui dépasse réellement la borne', async () => {
    await expect(readRequestTextWithLimit(streamedRequest(['12345'], '2'), 4))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })
})

describe('observeReadableStreamCompletion', () => {
  it('ne signale la fin qu’après EOF réel', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    const observed = observeReadableStreamCompletion(source)
    let completed = false
    void observed.completed.then(() => { completed = true })
    expect(completed).toBe(false)

    await expect(new Response(observed.stream).arrayBuffer())
      .resolves.toHaveProperty('byteLength', 3)
    await observed.completed
    expect(completed).toBe(true)
  })

  it('annule la source et termine sur abort', async () => {
    const cancel = vi.fn()
    const source = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
    const controller = new AbortController()
    const observed = observeReadableStreamCompletion(source, controller.signal)

    controller.abort(new Error('deadline'))
    await observed.completed
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('termine sans attendre un acknowledgement de cancel bloqué', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const source = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 })
    const observed = observeReadableStreamCompletion(source)

    await expect(observed.cancel('deadline')).resolves.toBeUndefined()
    await expect(observed.completed).resolves.toBeUndefined()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
