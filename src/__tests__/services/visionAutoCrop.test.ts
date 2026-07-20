import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileAttachment, Message } from '../../types'

const mocks = vi.hoisted(() => ({
  getFile: vi.fn(),
  cropImageAttachmentForVision: vi.fn(),
  activeUserId: null as string | null,
  sessionEpoch: 0,
}))

vi.mock('../../services/secureFileStorage', () => ({ getFile: mocks.getFile }))
vi.mock('../../services/userSession', () => ({
  getActiveUserId: () => mocks.activeUserId,
  getActiveSessionEpoch: () => mocks.sessionEpoch,
}))
vi.mock('../../services/imageNormalization', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/imageNormalization')>(),
  cropImageAttachmentForVision: mocks.cropImageAttachmentForVision,
}))

import {
  findLatestTerraVisionBatch,
  ensureMinimumCropRegion,
  isVisionAutoCropFollowUp,
  padLocatedRegion,
  parseLocatedImageRegion,
  prepareVisionAutoCrop,
  VisionAutoCropError,
} from '../../services/visionAutoCrop'

function image(id: string, overrides: Partial<FileAttachment> = {}): FileAttachment {
  return {
    id,
    name: `${id}.jpg`,
    type: 'image/jpeg',
    size: 250_000,
    width: 3072,
    height: 4096,
    normalizationVersion: 2,
    ...overrides,
  }
}

function message(id: string, role: Message['role'], content: string, files?: FileAttachment[], reasonCode?: string): Message {
  return { id, role, content, timestamp: 1, files, reasonCode }
}

beforeEach(() => {
  mocks.getFile.mockReset()
  mocks.cropImageAttachmentForVision.mockReset()
  mocks.activeUserId = null
  mocks.sessionEpoch = 0
})

describe('vision auto-crop intent et source', () => {
  it.each([
    'Tu peux lire ce qui est écrit sur le cadre blanc à gauche ?',
    'Zoome sur l’étiquette en bas de la photo',
    'Read the text on the screen at the right',
  ])('détecte un suivi visuel explicite: %s', (text) => {
    expect(isVisionAutoCropFollowUp(text)).toBe(true)
  })

  it.each([
    'merci',
    'quel temps fera-t-il demain ?',
    'rédige un email',
    'continue',
    'analyse ça dans le détail',
    'lis ce qui est écrit dans le mail',
  ])
    ('ne retransmet rien pour un suivi textuel: %s', (text) => {
      expect(isVisionAutoCropFollowUp(text)).toBe(false)
    })

  it('prend le dernier lot canonique réellement traité par Terra', () => {
    const old = image('old')
    const latest = [image('a'), image('b')]
    const messages = [
      message('u0', 'user', 'ancienne', [old]),
      message('a0', 'assistant', 'ok', undefined, 'image_vision_openai'),
      message('u1', 'user', 'lot', latest),
      message('a1', 'assistant', 'ok', undefined, 'image_vision_openai'),
      message('u2', 'user', 'et le cadre ?'),
    ]
    expect(findLatestTerraVisionBatch(messages)).toEqual(latest)
  })

  it('échoue fermé si le lot image le plus récent n’a pas été traité par Terra', () => {
    const messages = [
      message('u0', 'user', 'ancienne', [image('old')]),
      message('a0', 'assistant', 'ok', undefined, 'image_vision_openai'),
      message('u1', 'user', 'nouvelle', [image('new')]),
      message('a1', 'assistant', 'Claude', undefined, 'files_present'),
    ]
    expect(findLatestTerraVisionBatch(messages)).toBeNull()
  })

  it('un second suivi repart du lot original, pas du crop précédent', () => {
    const originals = [image('a'), image('b')]
    const crop = image('crop', {
      visionCrop: {
        kind: 'auto',
        sourceFileId: 'b',
        sourceFileIds: ['a', 'b'],
        rect: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
      },
    })
    const messages = [
      message('u0', 'user', 'photos', originals),
      message('a0', 'assistant', 'ok', undefined, 'image_vision_openai'),
      message('u1', 'user', 'premier détail', [crop]),
      message('a1', 'assistant', 'ok', undefined, 'image_vision_openai'),
    ]
    expect(findLatestTerraVisionBatch(messages)).toEqual(originals)
  })
})

describe('contrat bbox du localisateur', () => {
  const valid = '{"found":true,"imageIndex":1,"x":0.1,"y":0.2,"width":0.3,"height":0.2,"confidence":0.91}'

  it('accepte uniquement le JSON strict, borné et confiant', () => {
    expect(parseLocatedImageRegion(valid, 2)).toEqual({
      imageIndex: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.2, confidence: 0.91,
    })
  })

  it.each([
    `voici ${valid}`,
    '{"found":true,"imageIndex":0,"x":0,"y":0,"width":0.2,"height":0.2,"confidence":0.9,"url":"https://evil"}',
    '{"found":true,"imageIndex":2,"x":0,"y":0,"width":0.2,"height":0.2,"confidence":0.9}',
    '{"found":true,"imageIndex":0,"x":0.9,"y":0,"width":0.2,"height":0.2,"confidence":0.9}',
    '{"found":true,"imageIndex":0,"x":0,"y":0,"width":0.2,"height":0.2,"confidence":0.2}',
    '{"found":true,"imageIndex":0,"x":0,"y":0,"width":0.99,"height":0.99,"confidence":0.9}',
    '{"found":false}',
  ])('refuse une sortie ambiguë ou non conforme: %s', (raw) => {
    expect(parseLocatedImageRegion(raw, 2)).toBeNull()
  })

  it('ajoute la marge puis la bloque aux bords', () => {
    expect(padLocatedRegion({
      imageIndex: 0, x: 0, y: 0.9, width: 0.2, height: 0.1, confidence: 0.9,
    })).toEqual({ x: 0, y: 0.886, width: 0.228, height: 0.11399999999999999 })
  })

  it('élargit une très petite bbox à 256 px natifs sans upscale', () => {
    const region = ensureMinimumCropRegion(
      { x: 0.49, y: 0.49, width: 0.02, height: 0.02 },
      4096,
      3072,
    )
    expect(region.width * 4096).toBeCloseTo(256)
    expect(region.height * 3072).toBeCloseTo(256)
    expect(region.x).toBeGreaterThanOrEqual(0)
    expect(region.y + region.height).toBeLessThanOrEqual(1)
  })
})

describe('orchestration deux passes', () => {
  it('localise sur les aperçus puis recadre seulement la photo choisie', async () => {
    const sources = [image('a'), image('b')]
    mocks.getFile.mockImplementation(async (id: string) => ({ ...image(id), data: 'AA==' }))
    mocks.cropImageAttachmentForVision
      .mockResolvedValueOnce({ data: 'overview-a', mimeType: 'image/jpeg', size: 10, width: 576, height: 768, normalizationVersion: 2 })
      .mockResolvedValueOnce({ data: 'overview-b', mimeType: 'image/jpeg', size: 11, width: 768, height: 576, normalizationVersion: 2 })
      .mockResolvedValueOnce({ data: 'crop-b', mimeType: 'image/jpeg', size: 12, width: 1200, height: 800, normalizationVersion: 2 })
    const locate = vi.fn().mockResolvedValue({
      imageIndex: 1, x: 0.2, y: 0.3, width: 0.4, height: 0.25, confidence: 0.9,
    })

    const result = await prepareVisionAutoCrop(sources, 'lis le cadre à droite', 'conv-1', {
      expectedUserId: null,
      expectedSessionEpoch: 0,
      locate,
    })

    expect(mocks.getFile.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'b'])
    expect(locate).toHaveBeenCalledOnce()
    expect(locate.mock.calls[0]?.[0]).toHaveLength(2)
    expect(mocks.cropImageAttachmentForVision).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'b', data: 'AA==' }),
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    )
    expect(result).toMatchObject({
      data: 'crop-b',
      visionCrop: { kind: 'auto', sourceFileId: 'b', sourceFileIds: ['a', 'b'] },
    })
  })

  it('n’appelle jamais Terra si aucun original canonique n’est disponible', async () => {
    mocks.getFile.mockResolvedValue(null)
    const locate = vi.fn()
    await expect(prepareVisionAutoCrop([image('missing')], 'lis le texte', 'conv-1', {
      expectedUserId: null,
      expectedSessionEpoch: 0,
      locate,
    }))
      .rejects.toEqual(expect.objectContaining<VisionAutoCropError>({ code: 'asset_unavailable' }))
    expect(locate).not.toHaveBeenCalled()
  })

  it('arrête avant tout réseau si le compte change pendant le déchiffrement', async () => {
    mocks.activeUserId = 'account-a'
    mocks.getFile.mockImplementation(async (id: string) => {
      mocks.activeUserId = 'account-b'
      return { ...image(id), data: 'AA==' }
    })
    const locate = vi.fn()

    await expect(prepareVisionAutoCrop([image('a')], 'lis le texte de la photo', 'conv-1', {
      expectedUserId: 'account-a',
      expectedSessionEpoch: 0,
      locate,
    })).rejects.toEqual(expect.objectContaining<VisionAutoCropError>({ code: 'account_changed' }))
    expect(locate).not.toHaveBeenCalled()
  })

  it('refuse un crop devenu quasi plein cadre après ajout de marge', async () => {
    mocks.getFile.mockImplementation(async (id: string) => ({ ...image(id), data: 'AA==' }))
    mocks.cropImageAttachmentForVision.mockResolvedValue({
      data: 'overview', mimeType: 'image/jpeg', size: 10, width: 768, height: 576, normalizationVersion: 2,
    })
    const locate = vi.fn().mockResolvedValue({
      imageIndex: 0, x: 0.05, y: 0.05, width: 0.85, height: 0.9, confidence: 0.9,
    })

    await expect(prepareVisionAutoCrop([image('a')], 'analyse la photo', 'conv-1', {
      expectedUserId: null,
      expectedSessionEpoch: 0,
      locate,
    })).rejects.toEqual(expect.objectContaining<VisionAutoCropError>({ code: 'region_not_found' }))
    // Un seul crop = l'aperçu ; aucun recadrage HD n'a été produit.
    expect(mocks.cropImageAttachmentForVision).toHaveBeenCalledTimes(1)
  })
})
