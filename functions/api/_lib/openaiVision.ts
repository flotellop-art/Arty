export const OPENAI_VISION_MAX_IMAGES = 4
export const OPENAI_VISION_MAX_IMAGE_BYTES = 6 * 1024 * 1024
export const OPENAI_VISION_MAX_BATCH_BYTES = 24 * 1024 * 1024
export const OPENAI_VISION_MAX_SIDE = 4096

type SupportedImageMime = 'image/jpeg' | 'image/png'

export type OpenAIImageDataUrlValidation =
  | { ok: true; bytes: number; tokens: number }
  | {
      ok: false
      status: 400 | 413
      error: 'invalid_image_payload' | 'vision_payload_too_large'
      reason: string
    }

export type OpenAIVisionFailure = {
  ok: false
  status: 400 | 413
  error: 'invalid_image_payload' | 'vision_payload_too_large'
  reason: string
}

export type OpenAIVisionValidation =
  | {
      ok: true
      imageCount: number
      totalBytes: number
      validatedImageTokens?: number
      validatedImageCount?: number
    }
  | OpenAIVisionFailure

const DATA_URL_RE = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/i
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function invalid(reason: string): OpenAIVisionFailure {
  return { ok: false, status: 400, error: 'invalid_image_payload', reason }
}

function tooLarge(reason: string): OpenAIVisionFailure {
  return { ok: false, status: 413, error: 'vision_payload_too_large', reason }
}

function decodedBase64Length(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) return null
  const firstPadding = value.indexOf('=')
  if (firstPadding !== -1 && firstPadding < value.length - 2) return null
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

function base64Value(code: number): number {
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 71
  if (code >= 48 && code <= 57) return code + 4
  if (code === 43) return 62
  if (code === 47) return 63
  return 0
}

/** Lit un octet sans matérialiser le binaire complet de l'image en mémoire. */
function base64ByteAt(value: string, byteIndex: number, decodedLength: number): number | null {
  if (byteIndex < 0 || byteIndex >= decodedLength) return null
  const groupStart = Math.floor(byteIndex / 3) * 4
  const offset = byteIndex % 3
  const a = base64Value(value.charCodeAt(groupStart))
  const b = base64Value(value.charCodeAt(groupStart + 1))
  const c = base64Value(value.charCodeAt(groupStart + 2))
  const d = base64Value(value.charCodeAt(groupStart + 3))
  if (offset === 0) return (a << 2) | (b >> 4)
  if (offset === 1) return ((b & 15) << 4) | (c >> 2)
  return ((c & 3) << 6) | d
}

function pngDimensions(value: string, length: number): { width: number; height: number } | null {
  const expected = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (length < 57 || expected.some((byte, index) => base64ByteAt(value, index, length) !== byte)) return null
  const readU32 = (offset: number) => [0, 1, 2, 3].reduce(
    (total, index) => total * 256 + (base64ByteAt(value, offset + index, length) ?? 0),
    0,
  )
  const chunkType = (offset: number) => [0, 1, 2, 3]
    .map((index) => String.fromCharCode(base64ByteAt(value, offset + index, length) ?? 0))
    .join('')

  let cursor = 8
  let chunks = 0
  let dimensions: { width: number; height: number } | null = null
  let sawIdat = false
  while (cursor + 12 <= length && chunks < 4096) {
    chunks += 1
    const dataLength = readU32(cursor)
    const type = chunkType(cursor + 4)
    const next = cursor + 12 + dataLength
    if (!Number.isSafeInteger(next) || next > length) return null
    if (chunks === 1) {
      if (type !== 'IHDR' || dataLength !== 13) return null
      dimensions = { width: readU32(cursor + 8), height: readU32(cursor + 12) }
    } else if (type === 'IDAT') {
      sawIdat = true
    } else if (type === 'IEND') {
      return dataLength === 0 && next === length && sawIdat ? dimensions : null
    }
    cursor = next
  }
  return null
}

function jpegDimensions(value: string, length: number): { width: number; height: number } | null {
  if (
    length < 13 ||
    base64ByteAt(value, 0, length) !== 0xff ||
    base64ByteAt(value, 1, length) !== 0xd8 ||
    base64ByteAt(value, length - 2, length) !== 0xff ||
    base64ByteAt(value, length - 1, length) !== 0xd9
  ) return null

  let cursor = 2
  let segments = 0
  let dimensions: { width: number; height: number } | null = null
  while (cursor + 3 < length && segments < 4096) {
    segments += 1
    if (base64ByteAt(value, cursor, length) !== 0xff) return null
    while (cursor < length && base64ByteAt(value, cursor, length) === 0xff) cursor += 1
    const marker = base64ByteAt(value, cursor, length)
    if (marker === null || marker === 0x00 || marker === 0xd9) return null
    cursor += 1
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue

    const high = base64ByteAt(value, cursor, length)
    const low = base64ByteAt(value, cursor + 1, length)
    if (high === null || low === null) return null
    const segmentLength = high * 256 + low
    if (segmentLength < 2 || cursor + segmentLength > length) return null

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) return null
      const heightHigh = base64ByteAt(value, cursor + 3, length)
      const heightLow = base64ByteAt(value, cursor + 4, length)
      const widthHigh = base64ByteAt(value, cursor + 5, length)
      const widthLow = base64ByteAt(value, cursor + 6, length)
      if (heightHigh === null || heightLow === null || widthHigh === null || widthLow === null) return null
      dimensions = {
        width: widthHigh * 256 + widthLow,
        height: heightHigh * 256 + heightLow,
      }
    }
    // Une image JPEG décodable doit entrer dans un scan avant l'EOI. Les bytes
    // d'entropie ne se parsant pas comme des segments, on s'arrête ici après
    // avoir vérifié SOF + longueur SOS + EOI terminal.
    if (marker === 0xda) return dimensions
    cursor += segmentLength
  }
  return null
}

function dimensionsFor(
  mime: SupportedImageMime,
  base64: string,
  decodedLength: number,
): { width: number; height: number } | null {
  return mime === 'image/png'
    ? pngDimensions(base64, decodedLength)
    : jpegDimensions(base64, decodedLength)
}

/** Validation unitaire réutilisable par le parseur JSON streaming. */
export function validateOpenAIImageDataUrl(url: unknown): OpenAIImageDataUrlValidation {
  if (typeof url !== 'string') return invalid('invalid_image_block')
  const match = DATA_URL_RE.exec(url)
  if (!match) return invalid('data_url_required')

  const mime = match[1]?.toLowerCase() as SupportedImageMime | undefined
  const base64 = match[2]
  if (!mime || !base64) return invalid('invalid_data_url')
  const decodedLength = decodedBase64Length(base64)
  if (decodedLength === null) return invalid('invalid_base64')
  if (decodedLength > OPENAI_VISION_MAX_IMAGE_BYTES) return tooLarge('image_too_large')

  const dimensions = dimensionsFor(mime, base64, decodedLength)
  if (!dimensions) return invalid('mime_or_dimensions_mismatch')
  if (
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > OPENAI_VISION_MAX_SIDE ||
    dimensions.height > OPENAI_VISION_MAX_SIDE
  ) return invalid('image_dimensions_out_of_bounds')

  return {
    ok: true,
    bytes: decodedLength,
    tokens: Math.ceil(dimensions.width / 32) * Math.ceil(dimensions.height / 32),
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Valide le sous-ensemble vision accepté par Arty. Les dimensions servant au
 * wallet sont toujours extraites des bytes ; aucune metadata client n'est lue.
 */
export function validateOpenAIVisionPayload(payload: unknown): OpenAIVisionValidation {
  const body = record(payload)
  const messages = Array.isArray(body?.messages) ? body.messages : []
  let imageCount = 0
  let totalBytes = 0
  let imageTokens = 0

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = record(messages[messageIndex])
    const content = Array.isArray(message?.content) ? message.content : []
    for (const rawBlock of content) {
      const block = record(rawBlock)
      if (!block) continue
      const type = typeof block.type === 'string' ? block.type : ''

      if (type === 'file' || type === 'input_file' || type === 'document') {
        return invalid('non_image_media_not_allowed')
      }
      if (type !== 'image_url') continue

      imageCount += 1
      if (imageCount > OPENAI_VISION_MAX_IMAGES) return tooLarge('too_many_images')
      if (messageIndex !== messages.length - 1 || message?.role !== 'user') {
        return invalid('images_must_be_on_latest_user_turn')
      }

      const imageUrl = record(block.image_url)
      if (!imageUrl || imageUrl.detail !== 'original' || typeof imageUrl.url !== 'string') {
        return invalid('invalid_image_block')
      }
      const image = validateOpenAIImageDataUrl(imageUrl.url)
      if (!image.ok) return image
      totalBytes += image.bytes
      if (totalBytes > OPENAI_VISION_MAX_BATCH_BYTES) return tooLarge('image_batch_too_large')
      imageTokens += image.tokens
    }
  }

  if (imageCount > 0 && body?.model !== 'gpt-5.6-terra') {
    return invalid('vision_model_not_allowed')
  }

  // Le client émet une forme canonique unique : toutes les images, puis un
  // seul bloc texte. La reproduire côté serveur évite qu'un client bricolé
  // intercale des blocs non validés ou omette le relais textuel.
  if (imageCount > 0) {
    const streamOptions = record(body?.stream_options)
    if (
      body?.stream !== true ||
      streamOptions?.include_usage !== true ||
      !Number.isInteger(body?.max_completion_tokens) ||
      (body?.max_completion_tokens as number) < 1 ||
      (body?.max_completion_tokens as number) > 65_536
    ) {
      return invalid('vision_stream_contract_required')
    }
    const latest = record(messages[messages.length - 1])
    const content = Array.isArray(latest?.content) ? latest.content : []
    if (content.length !== imageCount + 1) return invalid('invalid_vision_block_order')
    for (let index = 0; index < imageCount; index += 1) {
      if (record(content[index])?.type !== 'image_url') return invalid('invalid_vision_block_order')
    }
    const trailing = record(content[content.length - 1])
    if (trailing?.type !== 'text' || typeof trailing.text !== 'string') {
      return invalid('invalid_vision_block_order')
    }
  }

  return {
    ok: true,
    imageCount,
    totalBytes,
    ...(imageCount > 0
      ? { validatedImageTokens: imageTokens, validatedImageCount: imageCount }
      : {}),
  }
}
