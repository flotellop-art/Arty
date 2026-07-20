import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ImageNormalizationError,
  MAX_IMAGE_SOURCE_BYTES,
  base64ImageToBlob,
  cropImageAttachmentForVision,
  inspectImageHeader,
  normalizeImageForVision,
} from '../../services/imageNormalization'

function jpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08])
  bytes[7] = (height >> 8) & 0xff
  bytes[8] = height & 0xff
  bytes[9] = (width >> 8) & 0xff
  bytes[10] = width & 0xff
  return bytes
}

function jpegBytesWithExifOrientation(
  width: number,
  height: number,
  orientation: number,
  appendXmp = false,
): Uint8Array {
  const exifPayload = new Uint8Array(32)
  exifPayload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]) // Exif\0\0
  exifPayload.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 6)
  exifPayload.set([0x01, 0x00], 14) // one IFD entry
  exifPayload.set([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00], 16)
  const exifSegment = new Uint8Array(4 + exifPayload.length)
  exifSegment.set([0xff, 0xe1, 0x00, exifPayload.length + 2])
  exifSegment.set(exifPayload, 4)
  const xmpPayload = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0x')
  const xmpSegment = new Uint8Array(4 + xmpPayload.length)
  xmpSegment.set([0xff, 0xe1, 0x00, xmpPayload.length + 2])
  xmpSegment.set(xmpPayload, 4)
  const frame = jpegBytes(width, height).slice(2)
  const bytes = new Uint8Array(2 + exifSegment.length + (appendXmp ? xmpSegment.length : 0) + frame.length)
  bytes.set([0xff, 0xd8])
  bytes.set(exifSegment, 2)
  let offset = 2 + exifSegment.length
  if (appendXmp) {
    bytes.set(xmpSegment, offset)
    offset += xmpSegment.length
  }
  bytes.set(frame, offset)
  return bytes
}

function pngBytes(width: number, height: number, colorType = 6): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  bytes[16] = (width >>> 24) & 0xff
  bytes[17] = (width >>> 16) & 0xff
  bytes[18] = (width >>> 8) & 0xff
  bytes[19] = width & 0xff
  bytes[20] = (height >>> 24) & 0xff
  bytes[21] = (height >>> 16) & 0xff
  bytes[22] = (height >>> 8) & 0xff
  bytes[23] = height & 0xff
  bytes[24] = 8
  bytes[25] = colorType
  return bytes
}

function webpVp8xBytes(width: number, height: number, hasAlpha = false): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  bytes.set(new TextEncoder().encode('WEBP'), 8)
  bytes.set(new TextEncoder().encode('VP8X'), 12)
  if (hasAlpha) bytes[20] = 0x10
  const encodedWidth = width - 1
  const encodedHeight = height - 1
  bytes.set([encodedWidth & 0xff, (encodedWidth >> 8) & 0xff, (encodedWidth >> 16) & 0xff], 24)
  bytes.set([encodedHeight & 0xff, (encodedHeight >> 8) & 0xff, (encodedHeight >> 16) & 0xff], 27)
  return bytes
}

function variedPixels(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(16 * 16 * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    const value = (i / 4) % 2 === 0 ? 20 : 220
    pixels.set([value, 80, 140, 255], i)
  }
  return pixels
}

function uniformPixels(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(16 * 16 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 255, 255, 255], i)
  return pixels
}

function bytesToBase64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

function transparentPixels(): Uint8ClampedArray {
  const pixels = variedPixels()
  pixels[3] = 0
  return pixels
}

function installCanvasMocks(signatures: Uint8ClampedArray[] = [], encodedSizes: number[] = []): {
  bitmapClose: ReturnType<typeof vi.fn>
  createBitmap: ReturnType<typeof vi.fn>
  encodedQualities: Array<number | undefined>
} {
  const encodedQualities: Array<number | undefined> = []
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas') return originalCreateElement(tagName)
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: signatures.shift() ?? variedPixels() })),
      })),
      toBlob: vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
        encodedQualities.push(quality)
        const mimeType = type ?? 'image/jpeg'
        const header = mimeType === 'image/png'
          ? pngBytes(canvas.width, canvas.height)
          : jpegBytes(canvas.width, canvas.height)
        const encoded = new Uint8Array(256)
        encoded.set(header)
        const blob = new Blob([encoded], { type: mimeType })
        const reportedSize = encodedSizes.shift()
        if (reportedSize !== undefined) Object.defineProperty(blob, 'size', { value: reportedSize })
        callback(blob)
      }),
    }
    return canvas as unknown as HTMLCanvasElement
  }) as typeof document.createElement)

  const bitmapClose = vi.fn()
  const createBitmap = vi.fn(async (blob: Blob, options?: ImageBitmapOptions) => {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
    const isWebp = String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    const sourceWidth = isPng
      ? ((bytes[16] ?? 0) * 0x1000000 + ((bytes[17] ?? 0) << 16) + ((bytes[18] ?? 0) << 8) + (bytes[19] ?? 0))
      : isWebp
        ? ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16)) + 1
      : (((bytes[9] ?? 0) << 8) | (bytes[10] ?? 0))
    const sourceHeight = isPng
      ? ((bytes[20] ?? 0) * 0x1000000 + ((bytes[21] ?? 0) << 16) + ((bytes[22] ?? 0) << 8) + (bytes[23] ?? 0))
      : isWebp
        ? ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16)) + 1
      : (((bytes[7] ?? 0) << 8) | (bytes[8] ?? 0))
    return {
      width: options?.resizeWidth ?? sourceWidth,
      height: options?.resizeHeight ?? sourceHeight,
      close: bitmapClose,
    }
  })
  vi.stubGlobal('createImageBitmap', createBitmap)
  return { bitmapClose, createBitmap, encodedQualities }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('inspectImageHeader', () => {
  it('lit les dimensions JPEG sans décoder les pixels', async () => {
    const blob = new Blob([jpegBytes(8064, 6048)], { type: 'image/jpeg' })
    await expect(inspectImageHeader(blob)).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      width: 8064,
      height: 6048,
      hasAlpha: false,
    })
  })

  it('détecte la transparence PNG depuis IHDR', async () => {
    const blob = new Blob([pngBytes(1200, 800, 6)], { type: 'image/png' })
    await expect(inspectImageHeader(blob)).resolves.toMatchObject({
      mimeType: 'image/png',
      width: 1200,
      height: 800,
      hasAlpha: true,
    })
  })

  it('lit les dimensions WebP VP8X', async () => {
    const blob = new Blob([webpVp8xBytes(4096, 3072, true)], { type: 'image/webp' })
    await expect(inspectImageHeader(blob)).resolves.toMatchObject({
      mimeType: 'image/webp',
      width: 4096,
      height: 3072,
      hasAlpha: true,
    })
  })

  it('refuse un MIME falsifié', async () => {
    const blob = new Blob([pngBytes(1200, 800)], { type: 'image/jpeg' })
    await expect(inspectImageHeader(blob, 'image/jpeg')).rejects.toMatchObject({ code: 'mime_mismatch' })
  })

  it('accepte le MIME Android générique image/* et garde la signature comme autorité', async () => {
    const blob = new Blob([jpegBytes(1200, 800)], { type: 'image/*' })
    await expect(inspectImageHeader(blob, 'image/*')).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
    })
  })

  it('lit EXIF orientation 6 sans la perdre devant un APP1 XMP ultérieur', async () => {
    const blob = new Blob([jpegBytesWithExifOrientation(8064, 6048, 6, true)], { type: 'image/jpeg' })
    await expect(inspectImageHeader(blob)).resolves.toMatchObject({
      width: 8064,
      height: 6048,
      orientation: 6,
    })
  })

  it('refuse une bombe de pixels avant tout appel au décodeur', async () => {
    const createBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createBitmap)
    const blob = new Blob([jpegBytes(10_000, 6_000)], { type: 'image/jpeg' })
    await expect(normalizeImageForVision(blob)).rejects.toMatchObject({ code: 'source_too_many_pixels' })
    expect(createBitmap).not.toHaveBeenCalled()
  })

  it('refuse la taille source avant toute lecture', async () => {
    const fake = { size: MAX_IMAGE_SOURCE_BYTES + 1, type: 'image/jpeg' } as Blob
    await expect(inspectImageHeader(fake)).rejects.toMatchObject({ code: 'source_too_large' })
  })

  it('refuse une base64 >32 Mio avant tout appel à atob', () => {
    const atobSpy = vi.fn()
    vi.stubGlobal('atob', atobSpy)
    const oversized = {
      includes: () => false,
      length: Math.ceil(MAX_IMAGE_SOURCE_BYTES / 3) * 4 + 1,
    } as unknown as string

    expect(() => base64ImageToBlob(oversized, 'image/jpeg')).toThrow(
      expect.objectContaining<ImageNormalizationError>({ code: 'source_too_large' }),
    )
    expect(atobSpy).not.toHaveBeenCalled()
  })
})

describe('normalizeImageForVision', () => {
  it('réduit 8064 × 6048 en 4096 × 3072 et ferme le bitmap', async () => {
    const { bitmapClose, createBitmap } = installCanvasMocks()
    const blob = new Blob([jpegBytes(8064, 6048)], { type: 'image/jpeg' })
    const result = await normalizeImageForVision(blob)

    expect(createBitmap).toHaveBeenCalledWith(blob, expect.objectContaining({
      resizeWidth: 4096,
      resizeHeight: 3072,
      resizeQuality: 'high',
    }))
    expect(result).toMatchObject({
      mimeType: 'image/jpeg',
      size: 256,
      width: 4096,
      height: 3072,
      normalizationVersion: 2,
    })
    // Source redimensionnée puis blob canonique redécodé pour validation.
    expect(bitmapClose).toHaveBeenCalledTimes(2)
  })

  it('préserve la transparence en PNG sans agrandir une petite image', async () => {
    const { createBitmap } = installCanvasMocks([
      transparentPixels(),
      transparentPixels(),
      transparentPixels(),
    ])
    const blob = new Blob([pngBytes(1200, 800, 6)], { type: 'image/png' })
    const result = await normalizeImageForVision(blob)

    expect(createBitmap).toHaveBeenCalledWith(blob, expect.not.objectContaining({ resizeWidth: expect.anything() }))
    expect(result).toMatchObject({ mimeType: 'image/png', width: 1200, height: 800 })
  })

  it('convertit un PNG RGBA réellement opaque en JPEG', async () => {
    installCanvasMocks([variedPixels(), variedPixels(), variedPixels()])
    const blob = new Blob([pngBytes(1200, 800, 6)], { type: 'image/png' })
    await expect(normalizeImageForVision(blob)).resolves.toMatchObject({ mimeType: 'image/jpeg' })
  })

  it('normalise un WebP opaque vers le canonique JPEG', async () => {
    installCanvasMocks()
    const blob = new Blob([webpVp8xBytes(1600, 1200)], { type: 'image/webp' })
    await expect(normalizeImageForVision(blob)).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
    })
  })

  it('conserve q.90 quand le premier encodage respecte déjà 4 Mio', async () => {
    const fourMiB = 4 * 1024 * 1024
    const { encodedQualities } = installCanvasMocks([], [fourMiB - 1])
    const blob = new Blob([jpegBytes(4032, 3024)], { type: 'image/jpeg' })

    await expect(normalizeImageForVision(blob)).resolves.toMatchObject({
      size: fourMiB - 1,
      width: 4032,
      height: 3024,
    })
    expect(encodedQualities).toEqual([0.9])
  })

  it('essaie les qualités JPEG jusqu’à q.70 avant de réduire les dimensions', async () => {
    const fourMiB = 4 * 1024 * 1024
    const { encodedQualities } = installCanvasMocks([], [
      fourMiB + 5,
      fourMiB + 4,
      fourMiB + 3,
      fourMiB + 2,
      fourMiB + 1,
      fourMiB - 1,
    ])
    const blob = new Blob([jpegBytes(4032, 3024)], { type: 'image/jpeg' })
    const result = await normalizeImageForVision(blob)

    expect(encodedQualities).toEqual([0.9, 0.875, 0.85, 0.8, 0.75, 0.7])
    expect(result).toMatchObject({ size: fourMiB - 1, width: 4032, height: 3024 })
  })

  it('réduit proportionnellement les dimensions si q.85 dépasse encore 4 Mio', async () => {
    const fiveMiB = 5 * 1024 * 1024
    const threeMiB = 3 * 1024 * 1024
    installCanvasMocks([], [fiveMiB, fiveMiB, fiveMiB, fiveMiB, fiveMiB, fiveMiB, threeMiB])
    const blob = new Blob([jpegBytes(4032, 3024)], { type: 'image/jpeg' })
    const result = await normalizeImageForVision(blob)

    expect(result.size).toBe(threeMiB)
    expect(result.width).toBeLessThan(4032)
    expect(result.height).toBeLessThan(3024)
    expect(result.width / result.height).toBeCloseTo(4 / 3, 2)
  })

  it('applique EXIF avant de calculer la cible 4K et conserve le ratio portrait', async () => {
    const { createBitmap } = installCanvasMocks()
    const blob = new Blob([jpegBytesWithExifOrientation(8064, 6048, 6)], { type: 'image/jpeg' })
    const result = await normalizeImageForVision(blob)

    expect(createBitmap).toHaveBeenNthCalledWith(1, blob, expect.objectContaining({
      resizeWidth: 3072,
      resizeHeight: 4096,
      imageOrientation: 'from-image',
    }))
    expect(result).toMatchObject({ width: 3072, height: 4096 })
  })

  it('échoue fermé si une source variée devient une sortie uniforme', async () => {
    installCanvasMocks([variedPixels(), uniformPixels()])
    const blob = new Blob([jpegBytes(4032, 3024)], { type: 'image/jpeg' })
    await expect(normalizeImageForVision(blob)).rejects.toEqual(
      expect.objectContaining<ImageNormalizationError>({ code: 'corrupt_output' }),
    )
  })

  it('revalide les dimensions réellement décodées avant de créer un canvas', async () => {
    const createElement = vi.spyOn(document, 'createElement')
    const bitmapClose = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 10_000,
      height: 6_000,
      close: bitmapClose,
    })))
    const blob = new Blob([jpegBytes(1200, 800)], { type: 'image/jpeg' })

    await expect(normalizeImageForVision(blob)).rejects.toMatchObject({
      code: 'source_too_many_pixels',
    })
    expect(createElement).not.toHaveBeenCalledWith('canvas')
    expect(bitmapClose).toHaveBeenCalledOnce()
  })

  it('refuse proprement une grande source si le resize bitmap sûr échoue', async () => {
    const createElement = vi.spyOn(document, 'createElement')
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('bitmap allocation failed')
    }))
    const blob = new Blob([jpegBytes(8064, 6048)], { type: 'image/jpeg' })

    await expect(normalizeImageForVision(blob)).rejects.toMatchObject({ code: 'decode_failed' })
    expect(createElement).not.toHaveBeenCalledWith('canvas')
  })
})

describe('cropImageAttachmentForVision', () => {
  it('recadre l’asset canonique orienté sans agrandir les pixels', async () => {
    installCanvasMocks()
    const result = await cropImageAttachmentForVision({
      id: 'photo',
      name: 'photo.jpg',
      type: 'image/jpeg',
      data: bytesToBase64(jpegBytes(3072, 4096)),
      normalizationVersion: 2,
    }, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })

    expect(result).toMatchObject({
      mimeType: 'image/jpeg',
      width: 1536,
      height: 2048,
      normalizationVersion: 2,
    })
  })

  it('produit un aperçu 768 px au même ratio pour la passe de repérage', async () => {
    installCanvasMocks()
    const result = await cropImageAttachmentForVision({
      id: 'photo',
      name: 'photo.jpg',
      type: 'image/jpeg',
      data: bytesToBase64(jpegBytes(3072, 4096)),
      normalizationVersion: 2,
    }, { x: 0, y: 0, width: 1, height: 1 }, { maxDimension: 768 })

    expect(result).toMatchObject({ width: 576, height: 768 })
  })

  it('refuse une ancienne image non canonique', async () => {
    await expect(cropImageAttachmentForVision({
      id: 'legacy',
      name: 'legacy.jpg',
      type: 'image/jpeg',
      data: bytesToBase64(jpegBytes(1200, 800)),
    }, { x: 0, y: 0, width: 1, height: 1 })).rejects.toMatchObject({ code: 'decode_failed' })
  })
})
