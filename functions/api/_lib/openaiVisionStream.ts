import {
  Tokenizer,
  TokenParser,
  TokenType,
  type ParsedTokenInfo,
} from '@streamparser/json-whatwg'
import { limitReadableStream, RequestBodyTooLargeError } from './boundedRequestBody'
import {
  OPENAI_VISION_MAX_BATCH_BYTES,
  OPENAI_VISION_MAX_IMAGES,
  validateOpenAIImageDataUrl,
  type OpenAIVisionFailure,
} from './openaiVision'

interface StreamBlockState {
  seen: Set<string>
  type?: unknown
  detail?: unknown
  text?: unknown
  validUrl?: true
}

const OPENAI_VISION_MAX_MESSAGES = 128
const OPENAI_VISION_MAX_CONTENT_BLOCKS = OPENAI_VISION_MAX_IMAGES + 1
const OPENAI_VISION_MAX_STRUCTURE_TOKENS = 8_192
const OPENAI_VISION_MAX_DEPTH = 16
const OPENAI_VISION_MAX_NON_IMAGE_STRING_CHARACTERS = 1024 * 1024

export type OpenAIVisionStreamValidation =
  | {
      ok: true
      imageCount: number
      totalBytes: number
      requestBytes: number
      validatedImageTokens: number
      validatedImageCount: number
      validatedInputTokens: number
      model: 'gpt-5.6-terra'
      maxCompletionTokens: number
    }
  | OpenAIVisionFailure

class VisionStreamValidationError extends Error {
  constructor(readonly result: OpenAIVisionFailure) {
    super(result.reason)
  }
}

const invalid = (reason: string): OpenAIVisionFailure => ({
  ok: false,
  status: 400,
  error: 'invalid_image_payload',
  reason,
})

const tooLarge = (reason: string): OpenAIVisionFailure => ({
  ok: false,
  status: 413,
  error: 'vision_payload_too_large',
  reason,
})

type JsonPath = Array<string | number>
type ParsedToken = ParsedTokenInfo.ParsedTokenInfo
type StructureContext =
  | { kind: 'object'; path: JsonPath; key?: string; expectingKey: boolean; expectingValue: boolean }
  | { kind: 'array'; path: JsonPath; index: number; expectingValue: boolean }

/**
 * Observe les tokens sans construire le DOM. Le TokenParser derrière ce
 * transform reste la source de vérité syntaxique ; ce tracker compte les
 * éléments réels de `messages`, y compris `{}` invisibles aux paths feuilles.
 */
function structureTracker(
  messageIndexes: Set<number>,
  blockCoordinates: Set<string>,
): TransformStream<ParsedToken, ParsedToken> {
  const stack: StructureContext[] = []
  let structureTokens = 0
  let nonImageStringCharacters = 0

  const allowedObjectKey = (path: JsonPath, key: string): boolean => {
    if (path.length === 0) {
      return key === 'model' || key === 'messages' || key === 'stream' ||
        key === 'stream_options' || key === 'max_completion_tokens'
    }
    if (path.length === 1 && path[0] === 'stream_options') return key === 'include_usage'
    if (path.length === 2 && path[0] === 'messages' && typeof path[1] === 'number') {
      return key === 'role' || key === 'content'
    }
    if (path.length === 4 && path[0] === 'messages' && path[2] === 'content') {
      return key === 'type' || key === 'image_url' || key === 'text'
    }
    if (
      path.length === 5 &&
      path[0] === 'messages' &&
      path[2] === 'content' &&
      path[4] === 'image_url'
    ) return key === 'url' || key === 'detail'
    return false
  }

  const currentValuePath = (): JsonPath => {
    const parent = stack[stack.length - 1]
    if (!parent) return []
    if (parent.kind === 'array') return [...parent.path, parent.index]
    return [...parent.path, parent.key ?? '']
  }
  const noteValue = (path: JsonPath) => {
    if (path.length === 2 && path[0] === 'messages' && typeof path[1] === 'number') {
      messageIndexes.add(path[1])
      if (messageIndexes.size > OPENAI_VISION_MAX_MESSAGES) {
        throw new VisionStreamValidationError(tooLarge('vision_structure_too_large'))
      }
    }
    if (
      path.length === 4 &&
      path[0] === 'messages' &&
      typeof path[1] === 'number' &&
      path[2] === 'content' &&
      typeof path[3] === 'number'
    ) {
      blockCoordinates.add(`${path[1]}:${path[3]}`)
      if (blockCoordinates.size > OPENAI_VISION_MAX_CONTENT_BLOCKS) {
        throw new VisionStreamValidationError(tooLarge('vision_structure_too_large'))
      }
    }
  }
  const completeParentValue = () => {
    const parent = stack[stack.length - 1]
    if (parent) parent.expectingValue = false
  }

  return new TransformStream<ParsedToken, ParsedToken>({
    transform(token, controller) {
      structureTokens += 1
      if (structureTokens > OPENAI_VISION_MAX_STRUCTURE_TOKENS) {
        throw new VisionStreamValidationError(tooLarge('vision_structure_too_large'))
      }
      const parent = stack[stack.length - 1]
      if (token.token === TokenType.STRING && parent?.kind === 'object' && parent.expectingKey) {
        const key = String(token.value)
        if (!allowedObjectKey(parent.path, key)) {
          throw new VisionStreamValidationError(invalid('invalid_vision_field'))
        }
        parent.key = key
        parent.expectingKey = false
        controller.enqueue(token)
        return
      }

      if (token.token === TokenType.STRING) {
        const path = currentValuePath()
        const isImageUrl =
          path.length === 6 &&
          path[0] === 'messages' &&
          typeof path[1] === 'number' &&
          path[2] === 'content' &&
          typeof path[3] === 'number' &&
          path[4] === 'image_url' &&
          path[5] === 'url'
        if (!isImageUrl) {
          nonImageStringCharacters += String(token.value).length
          if (nonImageStringCharacters > OPENAI_VISION_MAX_NON_IMAGE_STRING_CHARACTERS) {
            throw new VisionStreamValidationError(tooLarge('vision_scalar_strings_too_large'))
          }
        }
      }

      if (token.token === TokenType.COLON) {
        if (parent?.kind === 'object') parent.expectingValue = true
      } else if (token.token === TokenType.COMMA) {
        if (parent?.kind === 'object') {
          parent.expectingKey = true
          parent.key = undefined
        } else if (parent?.kind === 'array') {
          parent.index += 1
          parent.expectingValue = true
        }
      } else if (token.token === TokenType.LEFT_BRACE || token.token === TokenType.LEFT_BRACKET) {
        if (stack.length >= OPENAI_VISION_MAX_DEPTH) {
          throw new VisionStreamValidationError(tooLarge('vision_structure_too_large'))
        }
        const path = currentValuePath()
        noteValue(path)
        stack.push(token.token === TokenType.LEFT_BRACE
          ? { kind: 'object', path, expectingKey: true, expectingValue: false }
          : { kind: 'array', path, index: 0, expectingValue: true })
      } else if (token.token === TokenType.RIGHT_BRACE || token.token === TokenType.RIGHT_BRACKET) {
        stack.pop()
        completeParentValue()
      } else if (
        token.token === TokenType.STRING ||
        token.token === TokenType.NUMBER ||
        token.token === TokenType.TRUE ||
        token.token === TokenType.FALSE ||
        token.token === TokenType.NULL
      ) {
        noteValue(currentValuePath())
        completeParentValue()
      }
      controller.enqueue(token)
    },
  })
}

// Une data URL de 4 Mio occupe ~5,34 Mio. Refuser toute string JSON au-delà de
// 6 Mio AVANT le tokenizer empêche un client de faire matérialiser une unique
// string géante, même si elle se trouve sur un path ignoré.
const OPENAI_VISION_MAX_JSON_STRING_BYTES = 6 * 1024 * 1024

function jsonStringSizeGuard(): TransformStream<Uint8Array, Uint8Array> {
  let inString = false
  let escaped = false
  let bytesInString = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      for (const byte of chunk) {
        if (!inString) {
          if (byte === 0x22) {
            inString = true
            escaped = false
            bytesInString = 0
          }
          continue
        }
        if (escaped) {
          escaped = false
          bytesInString += 1
        } else if (byte === 0x5c) {
          escaped = true
          bytesInString += 1
        } else if (byte === 0x22) {
          inString = false
          continue
        } else {
          bytesInString += 1
        }
        if (bytesInString > OPENAI_VISION_MAX_JSON_STRING_BYTES) {
          throw new VisionStreamValidationError(tooLarge('json_string_too_large'))
        }
      }
      controller.enqueue(chunk)
    },
  })
}

/**
 * Parse seulement les métadonnées et UN bloc courant. Le body original reste
 * dans l'autre branche d'un `tee()` pour l'upstream : jamais de string JSON de
 * 32 Mio ni de DOM complet simultanés dans le Worker.
 */
export async function validateOpenAIVisionStream(
  stream: ReadableStream<Uint8Array>,
  maxRequestBytes: number,
  signal?: AbortSignal,
  onEarlyReject?: (reason: unknown) => void,
): Promise<OpenAIVisionStreamValidation> {
  let requestBytes = 0
  const messageIndexes = new Set<number>()
  const blockCoordinates = new Set<string>()
  const tokenizer = new Tokenizer({ stringBufferSize: 64 * 1024 })
  const parser = new TokenParser({
    keepStack: false,
    paths: [
      '$.model',
      '$.stream',
      '$.stream_options.include_usage',
      '$.max_completion_tokens',
      '$.messages.*.role',
      '$.messages.*.content.*.type',
      '$.messages.*.content.*.image_url.url',
      '$.messages.*.content.*.image_url.detail',
      '$.messages.*.content.*.text',
    ],
  })
  const reader = limitReadableStream(stream, maxRequestBytes, (bytes) => {
    requestBytes = bytes
  }, onEarlyReject)
    .pipeThrough(jsonStringSizeGuard())
    .pipeThrough(tokenizer)
    .pipeThrough(structureTracker(messageIndexes, blockCoordinates))
    .pipeThrough(parser)
    .getReader()
  const abortValidation = () => { void reader.cancel(signal?.reason) }
  if (signal?.aborted) abortValidation()
  else signal?.addEventListener('abort', abortValidation, { once: true })

  const top = new Map<string, unknown>()
  const roles = new Map<number, unknown>()
  const blocks = new Map<string, StreamBlockState>()
  let imageCount = 0
  let totalBytes = 0
  let imageTokens = 0
  let imageUrlBytes = 0

  const fail = (result: OpenAIVisionFailure): never => {
    throw new VisionStreamValidationError(result)
  }
  const setTop = (key: string, value: unknown) => {
    if (top.has(key)) fail(invalid('duplicate_vision_field'))
    top.set(key, value)
  }

  try {
    while (true) {
      const { done, value: event } = await reader.read()
      if (done) break
      const numericPath = event.stack
        .map((entry) => entry.key)
        .filter((entry): entry is number => typeof entry === 'number')

      if (numericPath.length === 0) {
        const key = String(event.key)
        if (key === 'model' || key === 'stream' || key === 'include_usage' || key === 'max_completion_tokens') {
          setTop(key, event.value)
        }
        continue
      }

      const messageIndex = numericPath[0]
      if (numericPath.length === 1 && event.key === 'role') {
        if (roles.has(messageIndex)) fail(invalid('duplicate_vision_field'))
        roles.set(messageIndex, event.value)
        continue
      }
      if (numericPath.length !== 2) continue

      const blockIndex = numericPath[1]
      const coordinate = `${messageIndex}:${blockIndex}`
      let block = blocks.get(coordinate)
      if (!block) {
        block = { seen: new Set() }
        blocks.set(coordinate, block)
      }
      const field = String(event.key)
      if (block.seen.has(field)) fail(invalid('duplicate_vision_field'))
      block.seen.add(field)
      if (field === 'type') {
        block.type = event.value
        if (event.value === 'file' || event.value === 'input_file' || event.value === 'document') {
          fail(invalid('non_image_media_not_allowed'))
        }
        if (event.value !== 'image_url' && event.value !== 'text') {
          fail(invalid('invalid_vision_block_order'))
        }
      } else if (field === 'detail') {
        block.detail = event.value
      } else if (field === 'text') {
        block.text = event.value
      } else if (field === 'url') {
        const image = validateOpenAIImageDataUrl(event.value)
        if (image.ok === false) throw new VisionStreamValidationError(image)
        imageCount += 1
        if (imageCount > OPENAI_VISION_MAX_IMAGES) fail(tooLarge('too_many_images'))
        totalBytes += image.bytes
        if (totalBytes > OPENAI_VISION_MAX_BATCH_BYTES) fail(tooLarge('image_batch_too_large'))
        imageTokens += image.tokens
        imageUrlBytes += (event.value as string).length
        block.validUrl = true
      }
    }
  } catch (error) {
    // Même invariant que limitReadableStream : attendre l'annulation d'une
    // seule branche `tee()` peut interbloquer le validateur. Le proxy annule
    // le sibling dès que ce résultat lui est rendu.
    void reader.cancel(error).catch(() => undefined)
    if (signal?.aborted) throw signal.reason ?? error
    if (error instanceof VisionStreamValidationError) return error.result
    if (error instanceof RequestBodyTooLargeError) throw error
    return invalid('invalid_json')
  } finally {
    signal?.removeEventListener('abort', abortValidation)
    reader.releaseLock()
  }

  if (signal?.aborted) throw signal.reason ?? new Error('vision_request_aborted')

  const model = top.get('model')
  const maxCompletionTokens = top.get('max_completion_tokens')
  if (imageCount === 0) return invalid('vision_transport_requires_images')
  if (model !== 'gpt-5.6-terra') return invalid('vision_model_not_allowed')
  if (
    top.get('stream') !== true ||
    top.get('include_usage') !== true ||
    !Number.isInteger(maxCompletionTokens) ||
    (maxCompletionTokens as number) < 1 ||
    (maxCompletionTokens as number) > 65_536
  ) return invalid('vision_stream_contract_required')

  const imageMessageIndexes = new Set<number>()
  for (const [coordinate, block] of blocks) {
    if (block.type === 'image_url') imageMessageIndexes.add(Number(coordinate.split(':', 1)[0]))
  }
  if (imageMessageIndexes.size !== 1) return invalid('images_must_be_on_latest_user_turn')
  const visionMessageIndex = [...imageMessageIndexes][0]
  const latestMessageIndex = Math.max(-1, ...messageIndexes)
  if (
    roles.size !== messageIndexes.size ||
    visionMessageIndex !== latestMessageIndex ||
    roles.get(visionMessageIndex) !== 'user'
  ) return invalid('images_must_be_on_latest_user_turn')
  if ([...blockCoordinates].some((coordinate) => Number(coordinate.split(':', 1)[0]) !== visionMessageIndex)) {
    return invalid('images_must_be_on_latest_user_turn')
  }

  const currentBlocks = [...blockCoordinates]
    .map((coordinate) => ({
      index: Number(coordinate.split(':')[1]),
      block: blocks.get(coordinate) ?? { seen: new Set<string>() },
    }))
    .sort((a, b) => a.index - b.index)
  if (currentBlocks.length !== imageCount + 1) return invalid('invalid_vision_block_order')
  for (let index = 0; index < imageCount; index += 1) {
    const current = currentBlocks[index]
    if (
      current?.index !== index ||
      current.block.type !== 'image_url' ||
      !current.block.validUrl ||
      current.block.detail !== 'original' ||
      current.block.seen.size !== 3 ||
      !current.block.seen.has('type') ||
      !current.block.seen.has('url') ||
      !current.block.seen.has('detail')
    ) {
      return invalid('invalid_vision_block_order')
    }
  }
  const trailing = currentBlocks[currentBlocks.length - 1]
  if (
    trailing?.index !== imageCount ||
    trailing.block.type !== 'text' ||
    typeof trailing.block.text !== 'string' ||
    trailing.block.seen.size !== 2 ||
    !trailing.block.seen.has('type') ||
    !trailing.block.seen.has('text')
  ) {
    return invalid('invalid_vision_block_order')
  }

  return {
    ok: true,
    imageCount,
    totalBytes,
    requestBytes,
    validatedImageTokens: imageTokens,
    validatedImageCount: imageCount,
    // Le JSON brut est une borne UTF-8 pessimiste. On retire seulement les
    // data URLs ASCII validées, puis on ajoute le coût dimensionnel exact.
    validatedInputTokens: Math.ceil(Math.max(0, requestBytes - imageUrlBytes + imageTokens)),
    model,
    maxCompletionTokens: maxCompletionTokens as number,
  }
}
