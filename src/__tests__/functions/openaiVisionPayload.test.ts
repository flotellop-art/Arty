// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  OPENAI_VISION_MAX_BATCH_BYTES,
  OPENAI_VISION_MAX_IMAGE_BYTES,
  validateOpenAIVisionPayload,
} from '../../../functions/api/_lib/openaiVision'

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function pngBase64(width: number, height: number, byteLength = 57): string {
  if (byteLength < 57) throw new Error('synthetic_png_too_small')
  const bytes = new Uint8Array(byteLength)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  writeU32(bytes, 8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  writeU32(bytes, 16, width)
  writeU32(bytes, 20, height)
  const idatLength = byteLength - 57
  writeU32(bytes, 33, idatLength)
  bytes.set([0x49, 0x44, 0x41, 0x54], 37)
  const iend = 45 + idatLength
  bytes.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], iend)
  return Buffer.from(bytes).toString('base64')
}

function jpegBase64(width: number, height: number): string {
  const bytes = new Uint8Array(27)
  bytes.set([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ])
  bytes.set([0xff, 0xda, 0x00, 0x02, 0xff, 0xd9], 21)
  return Buffer.from(bytes).toString('base64')
}

function imageBlock(base64: string, mime = 'image/png', detail = 'original') {
  return { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail } }
}

function payload(blocks: unknown[], model = 'gpt-5.6-terra') {
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: 4096,
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text: 'Analyse.' }] }],
  }
}

describe('validateOpenAIVisionPayload', () => {
  it('aligne exactement le lot 24 Mio sur quatre images de 6 Mio', () => {
    expect(OPENAI_VISION_MAX_BATCH_BYTES).toBe(4 * OPENAI_VISION_MAX_IMAGE_BYTES)
    const image = imageBlock(pngBase64(32, 32, OPENAI_VISION_MAX_IMAGE_BYTES))
    expect(validateOpenAIVisionPayload(payload([
      image, image, image, image,
    ]))).toMatchObject({
      ok: true,
      imageCount: 4,
      totalBytes: OPENAI_VISION_MAX_BATCH_BYTES,
      validatedImageCount: 4,
    })
  })

  it('dérive 12 288 tokens depuis un PNG 4096 × 3072', () => {
    expect(validateOpenAIVisionPayload(payload([imageBlock(pngBase64(4096, 3072))]))).toMatchObject({
      ok: true,
      imageCount: 1,
      validatedImageTokens: 12_288,
    })
  })

  it('dérive 16 384 tokens depuis un JPEG carré 4096 × 4096', () => {
    expect(validateOpenAIVisionPayload(payload([
      imageBlock(jpegBase64(4096, 4096), 'image/jpeg'),
    ]))).toMatchObject({ ok: true, validatedImageTokens: 16_384 })
  })

  it('additionne quatre images sans renvoyer les dimensions client', () => {
    const blocks = Array.from({ length: 4 }, () => imageBlock(pngBase64(4096, 4096)))
    expect(validateOpenAIVisionPayload(payload(blocks))).toMatchObject({
      ok: true,
      imageCount: 4,
      validatedImageTokens: 65_536,
    })
  })

  it('refuse cinq images', () => {
    const blocks = Array.from({ length: 5 }, () => imageBlock(pngBase64(32, 32)))
    expect(validateOpenAIVisionPayload(payload(blocks))).toMatchObject({
      ok: false,
      status: 413,
      reason: 'too_many_images',
    })
  })

  it('refuse URL distante, SVG, mauvais detail, mauvais modèle et PDF', () => {
    const remote = { type: 'image_url', image_url: { url: 'https://example.com/a.jpg', detail: 'original' } }
    const svg = imageBlock(Buffer.from('<svg/>').toString('base64'), 'image/svg+xml')
    const pdf = { type: 'input_file', file_data: 'data:application/pdf;base64,AA==' }
    expect(validateOpenAIVisionPayload(payload([remote]))).toMatchObject({ ok: false, reason: 'data_url_required' })
    expect(validateOpenAIVisionPayload(payload([svg]))).toMatchObject({ ok: false, reason: 'data_url_required' })
    expect(validateOpenAIVisionPayload(payload([imageBlock(pngBase64(32, 32), 'image/png', 'high')]))).toMatchObject({ ok: false, reason: 'invalid_image_block' })
    expect(validateOpenAIVisionPayload(payload([imageBlock(pngBase64(32, 32))], 'gpt-5'))).toMatchObject({ ok: false, reason: 'vision_model_not_allowed' })
    expect(validateOpenAIVisionPayload(payload([pdf]))).toMatchObject({ ok: false, reason: 'non_image_media_not_allowed' })
  })

  it('refuse MIME usurpé, dimensions >4096 et image >6 Mio', () => {
    expect(validateOpenAIVisionPayload(payload([
      imageBlock(jpegBase64(32, 32), 'image/png'),
    ]))).toMatchObject({ ok: false, reason: 'mime_or_dimensions_mismatch' })
    expect(validateOpenAIVisionPayload(payload([
      imageBlock(pngBase64(4097, 32)),
    ]))).toMatchObject({ ok: false, reason: 'image_dimensions_out_of_bounds' })
    expect(validateOpenAIVisionPayload(payload([
      imageBlock(pngBase64(32, 32, OPENAI_VISION_MAX_IMAGE_BYTES + 1)),
    ]))).toMatchObject({ ok: false, status: 413, reason: 'image_too_large' })
  })

  it('refuse une image historique au lieu de la refacturer silencieusement', () => {
    const body = payload([imageBlock(pngBase64(32, 32))])
    body.messages.unshift({ role: 'user', content: [imageBlock(pngBase64(32, 32))] })
    expect(validateOpenAIVisionPayload(body)).toMatchObject({
      ok: false,
      reason: 'images_must_be_on_latest_user_turn',
    })
  })

  it('impose la forme canonique images puis texte', () => {
    const image = imageBlock(pngBase64(32, 32))
    expect(validateOpenAIVisionPayload({
      model: 'gpt-5.6-terra',
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 4096,
      messages: [{
        role: 'user',
        content: [image, { type: 'text', text: 'milieu' }, image, { type: 'text', text: 'fin' }],
      }],
    })).toMatchObject({ ok: false, reason: 'invalid_vision_block_order' })
    expect(validateOpenAIVisionPayload({
      model: 'gpt-5.6-terra',
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 4096,
      messages: [{ role: 'user', content: [image] }],
    })).toMatchObject({ ok: false, reason: 'invalid_vision_block_order' })
  })

  it('exige le contrat stream canonique pour éviter une réécriture du gros body', () => {
    const body = payload([imageBlock(pngBase64(32, 32))])
    delete (body as Partial<typeof body>).stream_options
    expect(validateOpenAIVisionPayload(body)).toMatchObject({
      ok: false,
      reason: 'vision_stream_contract_required',
    })
  })
})
