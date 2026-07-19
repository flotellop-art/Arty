// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateOpenAIVisionStream } from '../../../functions/api/_lib/openaiVisionStream'
import {
  OPENAI_VISION_MAX_BATCH_BYTES,
  OPENAI_VISION_MAX_IMAGE_BYTES,
} from '../../../functions/api/_lib/openaiVision'
import { RequestBodyTooLargeError } from '../../../functions/api/_lib/boundedRequestBody'

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function pngBase64(width: number, height: number, byteLength: number, fill: number): string {
  const bytes = new Uint8Array(byteLength)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  writeU32(bytes, 8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  writeU32(bytes, 16, width)
  writeU32(bytes, 20, height)
  const idatLength = byteLength - 57
  writeU32(bytes, 33, idatLength)
  bytes.set([0x49, 0x44, 0x41, 0x54], 37)
  bytes.fill(fill, 41, 41 + idatLength)
  const iend = 45 + idatLength
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], iend)
  return Buffer.from(bytes).toString('base64')
}

function visionPayload(images: string[]) {
  return {
    model: 'gpt-5.6-terra',
    messages: [
      { role: 'system', content: 'Tu analyses des photos.' },
      {
        role: 'user',
        content: [
          ...images.map((base64) => ({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${base64}`, detail: 'original' },
          })),
          { type: 'text', text: 'Compare.' },
        ],
      },
    ],
    max_completion_tokens: 4096,
    stream: true,
    stream_options: { include_usage: true },
  }
}

function bodyStream(json: string, chunkBytes = 64 * 1024): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(json)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const end = Math.min(bytes.length, offset + chunkBytes)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

describe('validateOpenAIVisionStream', () => {
  it('valide quatre data URLs distinctes de 4 Mio sans construire le DOM complet', async () => {
    let images = [1, 2, 3, 4].map((fill) =>
      pngBase64(4096, 4096, OPENAI_VISION_MAX_IMAGE_BYTES, fill),
    )
    let json = JSON.stringify(visionPayload(images))
    const requestBytes = Buffer.byteLength(json)
    const [validationBody, upstreamBody] = bodyStream(json).tee()
    images = []
    json = ''
    const result = await validateOpenAIVisionStream(validationBody, 24 * 1024 * 1024)
    expect(result).toMatchObject({
      ok: true,
      imageCount: 4,
      totalBytes: OPENAI_VISION_MAX_BATCH_BYTES,
      validatedImageTokens: 65_536,
      validatedImageCount: 4,
      requestBytes,
    })
    if (result.ok) {
      expect(result.validatedInputTokens).toBeLessThan(70_000)
      expect(result.validatedInputTokens).toBeGreaterThan(65_536)
    }
    const upstreamReader = upstreamBody.getReader()
    let relayedBytes = 0
    while (true) {
      const { done, value } = await upstreamReader.read()
      if (done) break
      relayedBytes += value.byteLength
    }
    expect(relayedBytes).toBe(requestBytes)
  }, 30_000)

  it('rejette un bloc inconnu et un message vide après le tour vision', async () => {
    const image = pngBase64(32, 32, 57, 1)
    const extraBlock = visionPayload([image])
    ;(extraBlock.messages[1].content as unknown[]).push({ foo: 'invisible' })
    await expect(validateOpenAIVisionStream(
      bodyStream(JSON.stringify(extraBlock)),
      1024 * 1024,
    )).resolves.toMatchObject({ ok: false, reason: 'invalid_vision_field' })

    const trailingMessage = visionPayload([image])
    ;(trailingMessage.messages as unknown[]).push({})
    await expect(validateOpenAIVisionStream(
      bodyStream(JSON.stringify(trailingMessage)),
      1024 * 1024,
    )).resolves.toMatchObject({ ok: false, reason: 'images_must_be_on_latest_user_turn' })
  })

  it('exige detail original et interdit les champs croisés entre blocs', async () => {
    const image = pngBase64(32, 32, 57, 1)
    const low = visionPayload([image])
    const lowBlock = (low.messages[1].content as Array<Record<string, unknown>>)[0]
    ;(lowBlock.image_url as Record<string, unknown>).detail = 'low'
    await expect(validateOpenAIVisionStream(bodyStream(JSON.stringify(low)), 1024 * 1024))
      .resolves.toMatchObject({ ok: false, reason: 'invalid_vision_block_order' })

    const crossed = visionPayload([image])
    const crossedBlock = (crossed.messages[1].content as Array<Record<string, unknown>>)[0]
    crossedBlock.text = 'champ interdit'
    await expect(validateOpenAIVisionStream(bodyStream(JSON.stringify(crossed)), 1024 * 1024))
      .resolves.toMatchObject({ ok: false, reason: 'invalid_vision_block_order' })
  })

  it('rejette clé dupliquée, JSON avec suffixe et flux dépassant sa borne', async () => {
    const image = pngBase64(32, 32, 57, 1)
    const canonical = JSON.stringify(visionPayload([image]))
    const duplicate = canonical.replace(
      '"model":"gpt-5.6-terra"',
      '"model":"gpt-5.6-terra","model":"gpt-5.6-terra"',
    )
    await expect(validateOpenAIVisionStream(bodyStream(duplicate), 1024 * 1024))
      .resolves.toMatchObject({ ok: false, reason: 'duplicate_vision_field' })
    await expect(validateOpenAIVisionStream(bodyStream(`${canonical} trailing`), 1024 * 1024))
      .resolves.toMatchObject({ ok: false, reason: 'invalid_json' })
    await expect(validateOpenAIVisionStream(bodyStream(canonical), canonical.length - 1))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })

  it('coupe une string JSON géante avant que le tokenizer ne la matérialise', async () => {
    const image = pngBase64(32, 32, 57, 1)
    const payload = visionPayload([image])
    ;(payload.messages[0] as { content: string }).content = 'x'.repeat(6 * 1024 * 1024 + 1)
    await expect(validateOpenAIVisionStream(
      bodyStream(JSON.stringify(payload)),
      24 * 1024 * 1024,
    )).resolves.toMatchObject({
      ok: false,
      status: 413,
      reason: 'json_string_too_large',
    })
  })

  it('rejette tôt les champs inconnus et les structures adversariales', async () => {
    const image = pngBase64(32, 32, 57, 1)
    const unknown = visionPayload([image]) as Record<string, unknown>
    unknown.unexpected = 'x'.repeat(1024)
    await expect(validateOpenAIVisionStream(
      bodyStream(JSON.stringify(unknown)),
      2 * 1024 * 1024,
    )).resolves.toMatchObject({ ok: false, reason: 'invalid_vision_field' })

    const manyMessages = visionPayload([image])
    manyMessages.messages = [
      ...Array.from({ length: 128 }, () => ({ role: 'user', content: 'x' })),
      manyMessages.messages[1],
    ]
    await expect(validateOpenAIVisionStream(
      bodyStream(JSON.stringify(manyMessages)),
      2 * 1024 * 1024,
    )).resolves.toMatchObject({
      ok: false,
      status: 413,
      reason: 'vision_structure_too_large',
    })

    const tooMuchText = visionPayload([image])
    ;(tooMuchText.messages[0] as { content: string }).content = 'x'.repeat(1024 * 1024 + 1)
    await expect(validateOpenAIVisionStream(
      bodyStream(JSON.stringify(tooMuchText)),
      2 * 1024 * 1024,
    )).resolves.toMatchObject({
      ok: false,
      status: 413,
      reason: 'vision_scalar_strings_too_large',
    })

    const giantRoles = visionPayload([image])
    giantRoles.messages = [1, 2, 3, 4].map(() => ({
      role: 'x'.repeat(512 * 1024),
      content: 'x',
    })) as typeof giantRoles.messages
    await expect(validateOpenAIVisionStream(
      bodyStream(JSON.stringify(giantRoles)),
      4 * 1024 * 1024,
    )).resolves.toMatchObject({
      ok: false,
      status: 413,
      reason: 'vision_scalar_strings_too_large',
    })
  })
})
