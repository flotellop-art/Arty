// Auto-compression des images avant stockage IndexedDB.
// Resize au-delà de 2048px (longest side), réencode en JPEG q85.
// Préserve les PNG transparents petits et les images déjà légères.

const MAX_DIMENSION = 2048
const QUALITY = 0.85
const MIN_SIZE_FOR_COMPRESSION = 500 * 1024 // 500 KB
const PNG_PRESERVE_THRESHOLD = 1024 * 1024 // 1 MB

export interface CompressedImage {
  data: string // base64
  mimeType: string
  size: number
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteString = atob(base64.split(',').pop() || base64)
  const arr = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) arr[i] = byteString.charCodeAt(i)
  return new Blob([arr], { type: mimeType })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image load failed'))
    }
    img.src = url
  })
}

export async function compressImageIfNeeded(
  base64: string,
  mimeType: string
): Promise<CompressedImage> {
  if (!mimeType.startsWith('image/')) {
    return { data: base64, mimeType, size: base64.length }
  }

  const blob = base64ToBlob(base64, mimeType)

  // Already small enough → no recompression
  if (blob.size < MIN_SIZE_FOR_COMPRESSION) {
    return { data: base64, mimeType, size: blob.size }
  }

  let img: HTMLImageElement
  try {
    img = await loadImage(blob)
  } catch {
    // Couldn't decode (rare formats, browser limit) — passthrough
    return { data: base64, mimeType, size: blob.size }
  }

  const longest = Math.max(img.width, img.height)
  const needsResize = longest > MAX_DIMENSION
  const isPng = mimeType === 'image/png'
  const preservePng = isPng && blob.size <= PNG_PRESERVE_THRESHOLD && !needsResize

  if (preservePng) {
    return { data: base64, mimeType, size: blob.size }
  }

  const scale = needsResize ? MAX_DIMENSION / longest : 1
  const targetW = Math.round(img.width * scale)
  const targetH = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { data: base64, mimeType, size: blob.size }
  }
  ctx.drawImage(img, 0, 0, targetW, targetH)

  const outMime = isPng && blob.size <= PNG_PRESERVE_THRESHOLD ? 'image/png' : 'image/jpeg'
  const outBlob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, outMime, QUALITY)
  )
  if (!outBlob || outBlob.size >= blob.size) {
    return { data: base64, mimeType, size: blob.size }
  }
  const outBase64 = await blobToBase64(outBlob)
  return { data: outBase64, mimeType: outMime, size: outBlob.size }
}
