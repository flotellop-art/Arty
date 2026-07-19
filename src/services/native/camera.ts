import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { isNative } from './platform'

export interface CapturedPhoto {
  base64: string
  mimeType: string
}

export interface CapturePhotoOptions {
  /** Redimensionnement natif avant que les pixels entrent dans WKWebView. */
  maxDimension?: number
}

function nativeResizeOptions(options?: CapturePhotoOptions): { width: number; height: number } | Record<string, never> {
  const max = options?.maxDimension
  return typeof max === 'number' && max > 0
    ? { width: Math.floor(max), height: Math.floor(max) }
    : {}
}

/**
 * Take a photo with the device camera.
 * On web, falls back to the browser camera API.
 */
export async function takePhoto(options?: CapturePhotoOptions): Promise<CapturedPhoto | null> {
  try {
    const image = await Camera.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      ...nativeResizeOptions(options),
    })

    if (!image.base64String) return null

    return {
      base64: image.base64String,
      mimeType: `image/${image.format || 'jpeg'}`,
    }
  } catch (err) {
    console.warn('takePhoto failed:', err)
    return null
  }
}

/**
 * Pick a photo from the gallery.
 */
export async function pickPhoto(options?: CapturePhotoOptions): Promise<CapturedPhoto | null> {
  try {
    const image = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Photos,
      ...nativeResizeOptions(options),
    })

    if (!image.base64String) return null

    return {
      base64: image.base64String,
      mimeType: `image/${image.format || 'jpeg'}`,
    }
  } catch (err) {
    console.warn('pickPhoto failed:', err)
    return null
  }
}

/**
 * Scan a document using the camera (photo mode, high quality).
 * Useful for scanning invoices, plans, etc.
 */
export async function scanDocument(): Promise<CapturedPhoto | null> {
  if (!isNative) return null

  try {
    const image = await Camera.getPhoto({
      quality: 95,
      allowEditing: true,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      width: 2048,
      height: 2048,
    })

    if (!image.base64String) return null

    return {
      base64: image.base64String,
      mimeType: `image/${image.format || 'jpeg'}`,
    }
  } catch (err) {
    console.warn('scanDocument failed:', err)
    return null
  }
}
