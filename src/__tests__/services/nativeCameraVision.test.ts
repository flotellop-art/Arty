import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPhoto = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto },
  CameraResultType: { Base64: 'base64' },
  CameraSource: { Camera: 'CAMERA', Photos: 'PHOTOS' },
}))

vi.mock('../../services/native/platform', () => ({ isNative: true }))

import { pickPhoto, scanDocument, takePhoto } from '../../services/native/camera'

describe('native camera — fondation vision', () => {
  beforeEach(() => {
    getPhoto.mockReset()
    getPhoto.mockResolvedValue({ base64String: 'AQID', format: 'jpeg' })
  })

  it('demande le redimensionnement natif 4096 avant entrée dans la WebView', async () => {
    await expect(takePhoto({ maxDimension: 4096 })).resolves.toEqual({
      base64: 'AQID',
      mimeType: 'image/jpeg',
    })
    expect(getPhoto).toHaveBeenCalledWith(expect.objectContaining({
      resultType: 'base64',
      source: 'CAMERA',
      width: 4096,
      height: 4096,
    }))
  })

  it('verrouille aussi la sélection native sur le JPEG 4K', async () => {
    await expect(pickPhoto({ maxDimension: 4096 })).resolves.toMatchObject({ mimeType: 'image/jpeg' })
    expect(getPhoto).toHaveBeenCalledWith(expect.objectContaining({
      source: 'PHOTOS',
      width: 4096,
      height: 4096,
    }))
  })

  it('conserve le scan historique à 2048', async () => {
    await scanDocument()
    expect(getPhoto).toHaveBeenCalledWith(expect.objectContaining({ width: 2048, height: 2048 }))
  })
})
