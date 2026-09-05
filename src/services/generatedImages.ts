export const MAX_GENERATED_IMAGES_PER_TURN = 4
export const EMPTY_GENERATED_IMAGES: readonly string[] = Object.freeze([])
export function isGeneratedImageId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
}
/** Reject the whole malformed field, never infer authority from Markdown. */
export function generatedImageIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_GENERATED_IMAGES_PER_TURN ||
    !Array.from(value).every(isGeneratedImageId) || new Set(value).size !== value.length) return EMPTY_GENERATED_IMAGES
  return value
}

// Bounds after JSON/base64, not a complete image decoder or dimension-bomb defense.
export function validGeneratedImage(base64: unknown, mime: unknown): base64 is string {
  if (typeof base64 !== 'string' || base64.length < 16 || base64.length > 13_981_016 || base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(base64)) return false
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  if (base64.slice(0, base64.length - padding).includes('=') || base64.length / 4 * 3 - padding > 10 * 1024 * 1024) return false
  const prefix = atob(base64.slice(0, 16))
  if (mime === 'image/png') return prefix.startsWith('\x89PNG\r\n\x1a\n')
  if (mime === 'image/jpeg') return prefix.startsWith('\xff\xd8\xff')
  if (mime === 'image/webp') return prefix.startsWith('RIFF') && prefix.slice(8, 12) === 'WEBP'
  return false
}
