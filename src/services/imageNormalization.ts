import type { FileAttachment } from '../types'

export const IMAGE_NORMALIZATION_VERSION = 1
export const MAX_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024
export const MAX_IMAGE_SOURCE_PIXELS = 50_000_000
export const MAX_IMAGE_DIMENSION = 4096
export const MAX_NORMALIZED_IMAGE_BYTES = 6 * 1024 * 1024

const HEADER_READ_BYTES = 512 * 1024
const MAX_SAFE_HTML_FALLBACK_PIXELS = 16_777_216
const JPEG_QUALITY_STEPS = [0.9, 0.875, 0.85] as const
const MIN_OUTPUT_DIMENSION = 256
const MAX_RESIZE_ATTEMPTS = 8

export type ImageNormalizationErrorCode =
  | 'source_too_large'
  | 'source_too_many_pixels'
  | 'unsupported_format'
  | 'mime_mismatch'
  | 'decode_failed'
  | 'encode_failed'
  | 'output_too_large'
  | 'corrupt_output'

export class ImageNormalizationError extends Error {
  constructor(
    public readonly code: ImageNormalizationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ImageNormalizationError'
  }
}

export interface NormalizedImageAsset {
  data: string
  mimeType: 'image/jpeg' | 'image/png'
  size: number
  width: number
  height: number
  normalizationVersion: number
}

export interface ImageNormalizationOptions {
  /** Budget binaire de cet asset, plafonné par la borne globale de 6 Mio. */
  maxOutputBytes?: number
}

interface ImageHeader {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
  hasAlpha: boolean
  orientation: number
}

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

interface PixelSignature {
  minLuma: number
  maxLuma: number
  minAlpha: number
  maxAlpha: number
}

function normalizedMime(value: string): string {
  const mime = (value.split(';', 1)[0] ?? '').trim().toLowerCase()
  // Android ACTION_SEND peut ne fournir que le type générique image/*.
  // Ce n'est pas une déclaration de format : la signature reste l'autorité.
  if (mime === 'image/*') return ''
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

function byte(bytes: Uint8Array | Uint8ClampedArray, offset: number): number {
  return bytes[offset] ?? 0
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return byte(bytes, offset) | (byte(bytes, offset + 1) << 8) | (byte(bytes, offset + 2) << 16)
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    byte(bytes, offset) * 0x1000000 +
    (byte(bytes, offset + 1) << 16) +
    (byte(bytes, offset + 2) << 8) +
    byte(bytes, offset + 3)
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = ''
  for (let i = 0; i < length; i++) value += String.fromCharCode(byte(bytes, offset + i))
  return value
}

function inspectPng(bytes: Uint8Array): ImageHeader | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 26 || !signature.every((value, index) => byte(bytes, index) === value)) return null
  if (ascii(bytes, 12, 4) !== 'IHDR') return null
  const width = readU32BE(bytes, 16)
  const height = readU32BE(bytes, 20)
  const colorType = byte(bytes, 25)
  const hasAlphaChannel = colorType === 4 || colorType === 6
  let hasTransparencyChunk = false
  let chunkOffset = 8
  while (chunkOffset + 12 <= bytes.length) {
    const chunkLength = readU32BE(bytes, chunkOffset)
    const chunkType = ascii(bytes, chunkOffset + 4, 4)
    if (chunkType === 'tRNS') {
      hasTransparencyChunk = true
      break
    }
    if (chunkType === 'IDAT' || chunkType === 'IEND') break
    const nextOffset = chunkOffset + 12 + chunkLength
    if (nextOffset <= chunkOffset || nextOffset > bytes.length) break
    chunkOffset = nextOffset
  }
  return { mimeType: 'image/png', width, height, hasAlpha: hasAlphaChannel || hasTransparencyChunk, orientation: 1 }
}

function inspectExifOrientation(bytes: Uint8Array, offset: number, length: number): number | null {
  if (length < 14 || ascii(bytes, offset, 6) !== 'Exif\0\0') return null
  const tiff = offset + 6
  const endian = ascii(bytes, tiff, 2)
  const littleEndian = endian === 'II'
  if (!littleEndian && endian !== 'MM') return 1
  const end = Math.min(bytes.length, offset + length)
  const read16 = (position: number): number => {
    if (position + 2 > end) return 0
    return littleEndian
      ? byte(bytes, position) | (byte(bytes, position + 1) << 8)
      : (byte(bytes, position) << 8) | byte(bytes, position + 1)
  }
  const read32 = (position: number): number => {
    if (position + 4 > end) return 0
    return littleEndian
      ? byte(bytes, position) + byte(bytes, position + 1) * 0x100 + byte(bytes, position + 2) * 0x10000 + byte(bytes, position + 3) * 0x1000000
      : readU32BE(bytes, position)
  }
  if (read16(tiff + 2) !== 42) return 1
  const ifd = tiff + read32(tiff + 4)
  if (ifd + 2 > end) return 1
  const entries = read16(ifd)
  for (let index = 0; index < entries; index++) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > end) break
    if (read16(entry) !== 0x0112 || read16(entry + 2) !== 3 || read32(entry + 4) < 1) continue
    const orientation = read16(entry + 8)
    return orientation >= 1 && orientation <= 8 ? orientation : 1
  }
  return 1
}

function inspectJpeg(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 4 || byte(bytes, 0) !== 0xff || byte(bytes, 1) !== 0xd8) return null
  let offset = 2
  let width = 0
  let height = 0
  let orientation = 1
  while (offset + 8 <= bytes.length) {
    while (offset < bytes.length && byte(bytes, offset) === 0xff) offset++
    if (offset >= bytes.length) break
    const marker = byte(bytes, offset++)
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const segmentLength = (byte(bytes, offset) << 8) | byte(bytes, offset + 1)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break
    if (marker === 0xe1) {
      const parsedOrientation = inspectExifOrientation(bytes, offset + 2, segmentLength - 2)
      if (parsedOrientation !== null) orientation = parsedOrientation
    }
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame && segmentLength >= 7) {
      height = (byte(bytes, offset + 3) << 8) | byte(bytes, offset + 4)
      width = (byte(bytes, offset + 5) << 8) | byte(bytes, offset + 6)
    }
    offset += segmentLength
  }
  return width > 0 && height > 0
    ? { mimeType: 'image/jpeg', width, height, hasAlpha: false, orientation }
    : null
}

function inspectWebp(bytes: Uint8Array): ImageHeader | null {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP'
  ) return null

  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    return {
      mimeType: 'image/webp',
      width: readU24LE(bytes, 24) + 1,
      height: readU24LE(bytes, 27) + 1,
      hasAlpha: (byte(bytes, 20) & 0x10) !== 0,
      orientation: 1,
    }
  }
  if (chunk === 'VP8L' && byte(bytes, 20) === 0x2f) {
    const bits =
      byte(bytes, 21) |
      (byte(bytes, 22) << 8) |
      (byte(bytes, 23) << 16) |
      (byte(bytes, 24) << 24)
    return {
      mimeType: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      hasAlpha: true,
      orientation: 1,
    }
  }
  if (
    chunk === 'VP8 ' &&
    byte(bytes, 23) === 0x9d &&
    byte(bytes, 24) === 0x01 &&
    byte(bytes, 25) === 0x2a
  ) {
    return {
      mimeType: 'image/webp',
      width: ((byte(bytes, 27) << 8) | byte(bytes, 26)) & 0x3fff,
      height: ((byte(bytes, 29) << 8) | byte(bytes, 28)) & 0x3fff,
      hasAlpha: false,
      orientation: 1,
    }
  }
  return null
}

async function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsArrayBuffer(blob)
  })
}

export async function inspectImageHeader(blob: Blob, declaredMimeType = blob.type): Promise<ImageHeader> {
  if (blob.size <= 0 || blob.size > MAX_IMAGE_SOURCE_BYTES) {
    throw new ImageNormalizationError('source_too_large', 'Image source exceeds 32 MiB')
  }

  const headerBytes = new Uint8Array(await blobArrayBuffer(blob.slice(0, HEADER_READ_BYTES)))
  const header = inspectJpeg(headerBytes) ?? inspectPng(headerBytes) ?? inspectWebp(headerBytes)
  if (!header || header.width <= 0 || header.height <= 0) {
    throw new ImageNormalizationError('unsupported_format', 'Unsupported or malformed image')
  }

  const declared = normalizedMime(declaredMimeType)
  if (
    declared &&
    declared !== 'application/octet-stream' &&
    declared !== header.mimeType
  ) {
    throw new ImageNormalizationError(
      'mime_mismatch',
      `Declared MIME ${declared} does not match ${header.mimeType}`,
    )
  }

  if (header.width * header.height > MAX_IMAGE_SOURCE_PIXELS) {
    throw new ImageNormalizationError(
      'source_too_many_pixels',
      'Image source exceeds the safe pixel budget',
    )
  }
  return header
}

function targetDimensions(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= MAX_IMAGE_DIMENSION) return { width, height }
  const scale = MAX_IMAGE_DIMENSION / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function orientedSourceDimensions(header: ImageHeader): { width: number; height: number } {
  return header.orientation >= 5 && header.orientation <= 8
    ? { width: header.height, height: header.width }
    : { width: header.width, height: header.height }
}

async function loadHtmlImage(blob: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Image decode failed'))
      image.src = url
    })
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    release: () => URL.revokeObjectURL(url),
  }
}

async function decodeImage(blob: Blob, header: ImageHeader): Promise<DecodedImage> {
  const oriented = orientedSourceDimensions(header)
  const target = targetDimensions(oriented.width, oriented.height)
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      const needsResize = target.width !== oriented.width || target.height !== oriented.height
      const options: ImageBitmapOptions = needsResize
        ? {
            imageOrientation: 'from-image',
            resizeWidth: target.width,
            resizeHeight: target.height,
            resizeQuality: 'high',
          }
        : { imageOrientation: 'from-image' }
      const bitmap = await globalThis.createImageBitmap(blob, options)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      }
    } catch (error) {
      // Certaines versions WKWebView exposent createImageBitmap mais échouent
      // sur le resize. Ne jamais répondre à une pression mémoire en lançant un
      // second décodage HTML plein format d'une source de 40–50 MP.
      if (oriented.width * oriented.height > MAX_SAFE_HTML_FALLBACK_PIXELS) {
        if (error instanceof ImageNormalizationError) throw error
        throw new ImageNormalizationError('decode_failed', 'Safe bitmap resize failed')
      }
    }
  }

  if (oriented.width * oriented.height > MAX_SAFE_HTML_FALLBACK_PIXELS) {
    throw new ImageNormalizationError('decode_failed', 'Safe bitmap resize is unavailable')
  }
  return loadHtmlImage(blob)
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function drawTiled(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  const canvas = createCanvas(targetWidth, targetHeight)
  try {
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new ImageNormalizationError('decode_failed', 'Canvas 2D unavailable')

    const tileSize = 1024
    for (let y = 0; y < targetHeight; y += tileSize) {
      for (let x = 0; x < targetWidth; x += tileSize) {
        const dw = Math.min(tileSize, targetWidth - x)
        const dh = Math.min(tileSize, targetHeight - y)
        const sx = (x / targetWidth) * sourceWidth
        const sy = (y / targetHeight) * sourceHeight
        const sw = (dw / targetWidth) * sourceWidth
        const sh = (dh / targetHeight) * sourceHeight
        context.drawImage(source, sx, sy, sw, sh, x, y, dw, dh)
      }
    }
    return canvas
  } catch (error) {
    canvas.width = 1
    canvas.height = 1
    throw error
  }
}

function pixelSignature(source: CanvasImageSource, width: number, height: number): PixelSignature {
  const canvas = createCanvas(16, 16)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    canvas.width = 1
    canvas.height = 1
    throw new ImageNormalizationError('corrupt_output', 'Pixel validation unavailable')
  }
  try {
    context.drawImage(source, 0, 0, width, height, 0, 0, 16, 16)
    const pixels = context.getImageData(0, 0, 16, 16).data
    let minLuma = 255
    let maxLuma = 0
    let minAlpha = 255
    let maxAlpha = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const luma = Math.round((byte(pixels, i) * 299 + byte(pixels, i + 1) * 587 + byte(pixels, i + 2) * 114) / 1000)
      minLuma = Math.min(minLuma, luma)
      maxLuma = Math.max(maxLuma, luma)
      minAlpha = Math.min(minAlpha, byte(pixels, i + 3))
      maxAlpha = Math.max(maxAlpha, byte(pixels, i + 3))
    }
    return { minLuma, maxLuma, minAlpha, maxAlpha }
  } catch {
    throw new ImageNormalizationError('corrupt_output', 'Pixel validation failed')
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}

function hasVariation(signature: PixelSignature): boolean {
  return signature.maxLuma - signature.minLuma > 3 || signature.maxAlpha - signature.minAlpha > 3
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size <= 0) {
        reject(new ImageNormalizationError('encode_failed', 'Image encode failed'))
      } else {
        resolve(blob)
      }
    }, mimeType, quality)
  })
}

function canvasHasTransparency(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new ImageNormalizationError('corrupt_output', 'Alpha validation unavailable')
  const tileSize = 512
  try {
    for (let y = 0; y < canvas.height; y += tileSize) {
      for (let x = 0; x < canvas.width; x += tileSize) {
        const width = Math.min(tileSize, canvas.width - x)
        const height = Math.min(tileSize, canvas.height - y)
        const pixels = context.getImageData(x, y, width, height).data
        for (let index = 3; index < pixels.length; index += 4) {
          if (byte(pixels, index) < 255) return true
        }
      }
    }
    return false
  } catch {
    throw new ImageNormalizationError('corrupt_output', 'Alpha validation failed')
  }
}

async function encodeWithinLimit(
  decoded: DecodedImage,
  sourceMayHaveAlpha: boolean,
  maxOutputBytes: number,
): Promise<{ blob: Blob; width: number; height: number; mimeType: 'image/jpeg' | 'image/png' }> {
  let { width, height } = targetDimensions(decoded.width, decoded.height)
  let attempt = 0
  let usefulAlpha: boolean | undefined

  while (attempt < MAX_RESIZE_ATTEMPTS) {
    const canvas = drawTiled(decoded.source, decoded.width, decoded.height, width, height)
    try {
      // Inspecte l'asset cible par tuiles : un PNG RGBA réellement opaque peut
      // devenir JPEG, mais même une petite zone transparente reste en PNG.
      if (sourceMayHaveAlpha && usefulAlpha === undefined) {
        usefulAlpha = canvasHasTransparency(canvas)
      }
      const preserveAlpha = usefulAlpha === true
      const mimeType = preserveAlpha ? 'image/png' : 'image/jpeg'
      let blob: Blob
      if (mimeType === 'image/jpeg') {
        const finalQuality = JPEG_QUALITY_STEPS[JPEG_QUALITY_STEPS.length - 1] ?? 0.85
        const qualities: readonly number[] = attempt === 0 ? JPEG_QUALITY_STEPS : [finalQuality]
        blob = await canvasToBlob(canvas, mimeType, qualities[0] ?? finalQuality)
        for (let index = 1; index < qualities.length; index++) {
          const quality = qualities[index] ?? finalQuality
          blob = await canvasToBlob(canvas, mimeType, quality)
          if (blob.size <= maxOutputBytes) break
        }
      } else {
        blob = await canvasToBlob(canvas, mimeType)
      }

      if (blob.size <= maxOutputBytes) return { blob, width, height, mimeType }
      if (width <= MIN_OUTPUT_DIMENSION || height <= MIN_OUTPUT_DIMENSION) break

      const scale = Math.min(0.9, Math.sqrt(maxOutputBytes / blob.size) * 0.95)
      const nextWidth = Math.max(MIN_OUTPUT_DIMENSION, Math.floor(width * scale))
      const nextHeight = Math.max(MIN_OUTPUT_DIMENSION, Math.floor(height * scale))
      if (nextWidth === width && nextHeight === height) break
      width = nextWidth
      height = nextHeight
      attempt++
    } finally {
      canvas.width = 1
      canvas.height = 1
    }
  }

  throw new ImageNormalizationError('output_too_large', 'Normalized image exceeds 6 MiB')
}

async function verifyEncodedOutput(
  encoded: { blob: Blob; width: number; height: number; mimeType: 'image/jpeg' | 'image/png' },
  sourceSignature: PixelSignature,
): Promise<void> {
  let decoded: DecodedImage | null = null
  try {
    const header = await inspectImageHeader(encoded.blob, encoded.mimeType)
    if (header.width !== encoded.width || header.height !== encoded.height) {
      throw new ImageNormalizationError('corrupt_output', 'Encoded dimensions do not match')
    }
    decoded = await decodeImage(encoded.blob, header)
    if (decoded.width !== encoded.width || decoded.height !== encoded.height) {
      throw new ImageNormalizationError('corrupt_output', 'Encoded image could not be decoded exactly')
    }
    const outputSignature = pixelSignature(decoded.source, decoded.width, decoded.height)
    if (hasVariation(sourceSignature) && !hasVariation(outputSignature)) {
      throw new ImageNormalizationError('corrupt_output', 'Encoded image became uniform')
    }
  } catch (error) {
    if (error instanceof ImageNormalizationError && error.code === 'corrupt_output') throw error
    throw new ImageNormalizationError('corrupt_output', 'Encoded image failed validation')
  } finally {
    decoded?.release()
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

export function base64ImageToBlob(base64: string, mimeType: string): Blob {
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  // Gate AVANT atob : sinon une entrée native/partagée surdimensionnée alloue
  // d'abord une string binaire puis un Uint8Array complet avant le refus Blob.
  const maxEncodedLength = Math.ceil(MAX_IMAGE_SOURCE_BYTES / 3) * 4
  if (payload.length > maxEncodedLength) {
    throw new ImageNormalizationError('source_too_large', 'Image source exceeds 32 MiB')
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  const estimatedBytes = Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
  if (estimatedBytes > MAX_IMAGE_SOURCE_BYTES) {
    throw new ImageNormalizationError('source_too_large', 'Image source exceeds 32 MiB')
  }
  try {
    const decoded = atob(payload)
    const bytes = new Uint8Array(decoded.length)
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i)
    return new Blob([bytes], { type: normalizedMime(mimeType) })
  } catch {
    throw new ImageNormalizationError('decode_failed', 'Invalid base64 image')
  }
}

export async function normalizeImageForVision(
  source: Blob,
  declaredMimeType = source.type,
  options: ImageNormalizationOptions = {},
): Promise<NormalizedImageAsset> {
  const header = await inspectImageHeader(source, declaredMimeType)
  const maxOutputBytes = Math.min(
    MAX_NORMALIZED_IMAGE_BYTES,
    Math.max(1, Math.floor(options.maxOutputBytes ?? MAX_NORMALIZED_IMAGE_BYTES)),
  )
  let decoded: DecodedImage | null = null
  try {
    decoded = await decodeImage(source, header)
    if (decoded.width <= 0 || decoded.height <= 0) {
      throw new ImageNormalizationError('decode_failed', 'Decoded image has invalid dimensions')
    }
    // Le header est contrôlé avant décodage, puis les dimensions réellement
    // produites le sont à nouveau : un conteneur malformé ne peut pas annoncer
    // 1 px et faire poursuivre le pipeline avec un bitmap géant.
    if (decoded.width * decoded.height > MAX_IMAGE_SOURCE_PIXELS) {
      throw new ImageNormalizationError(
        'source_too_many_pixels',
        'Decoded image exceeds the safe pixel budget',
      )
    }
    const sourceSignature = pixelSignature(decoded.source, decoded.width, decoded.height)
    const encoded = await encodeWithinLimit(decoded, header.hasAlpha, maxOutputBytes)
    // La validation porte sur le blob réellement canonique, après toBlob.
    // Libérer d'abord le bitmap source borne le pic mémoire du second décodage.
    decoded.release()
    decoded = null
    await verifyEncodedOutput(encoded, sourceSignature)
    return {
      data: await blobToBase64(encoded.blob),
      mimeType: encoded.mimeType,
      size: encoded.blob.size,
      width: encoded.width,
      height: encoded.height,
      normalizationVersion: IMAGE_NORMALIZATION_VERSION,
    }
  } catch (error) {
    if (error instanceof ImageNormalizationError) throw error
    throw new ImageNormalizationError('decode_failed', 'Image could not be normalized')
  } finally {
    decoded?.release()
  }
}

export async function normalizeImageAttachmentForVision(
  file: Pick<FileAttachment, 'id' | 'name' | 'type' | 'data'>,
  options: ImageNormalizationOptions = {},
): Promise<FileAttachment> {
  if (!file.data) throw new ImageNormalizationError('decode_failed', 'Image data is missing')
  const normalized = await normalizeImageForVision(
    base64ImageToBlob(file.data, file.type),
    file.type,
    options,
  )
  return {
    id: file.id,
    name: file.name,
    type: normalized.mimeType,
    data: normalized.data,
    size: normalized.size,
    width: normalized.width,
    height: normalized.height,
    normalizationVersion: normalized.normalizationVersion,
  }
}
