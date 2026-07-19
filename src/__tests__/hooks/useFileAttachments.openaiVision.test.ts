import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({ getFile: vi.fn() }))
vi.mock('../../services/secureFileStorage', () => ({ getFile: storageMocks.getFile }))
import i18n from '../../i18n'
import {
  buildOpenAIVisionContentBlocks,
  buildTextOnlyMessages,
} from '../../hooks/useFileAttachments'
import type { FileAttachment, Message } from '../../types'

const image = (id: string, type: 'image/jpeg' | 'image/png'): FileAttachment => ({
  id,
  name: `${id}.${type === 'image/png' ? 'png' : 'jpg'}`,
  type,
  data: `base64-${id}`,
  size: 100,
  width: 4096,
  height: 3072,
  normalizationVersion: 1,
})

describe('builder OpenAI vision one-shot', () => {
  beforeEach(async () => {
    storageMocks.getFile.mockReset()
    await i18n.changeLanguage('fr')
  })

  it('place les images courantes avant le texte avec detail original', async () => {
    const blocks = await buildOpenAIVisionContentBlocks('Compare-les.', [
      image('a', 'image/jpeg'),
      image('b', 'image/png'),
    ])
    expect(blocks).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,base64-a', detail: 'original' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,base64-b', detail: 'original' } },
      { type: 'text', text: 'Compare-les.' },
    ])
  })

  it('localise le relais image-only', async () => {
    await expect(buildOpenAIVisionContentBlocks('', [image('a', 'image/jpeg')]))
      .resolves.toEqual(expect.arrayContaining([{ type: 'text', text: 'Analyse cette photo.' }]))
  })

  it('refuse un asset non canonique et un PDF si le builder est mal appelé', async () => {
    await expect(buildOpenAIVisionContentBlocks('x', [{ ...image('a', 'image/jpeg'), normalizationVersion: undefined }]))
      .rejects.toThrow('openai_vision_asset_not_canonical')
    await expect(buildOpenAIVisionContentBlocks('x', [{
      id: 'pdf', name: 'doc.pdf', type: 'application/pdf', data: 'AA==', size: 1,
    }])).rejects.toThrow('openai_vision_requires_images_only')
  })

  it('échoue si les pixels hydratés ont disparu au lieu de retomber en texte', async () => {
    storageMocks.getFile.mockResolvedValue(null)
    const unavailable = { ...image('lost', 'image/jpeg'), data: undefined }
    await expect(buildOpenAIVisionContentBlocks('Analyse.', [unavailable]))
      .rejects.toThrow('openai_vision_asset_unavailable')
  })

  it("laisse l'historique photo en texte seul", async () => {
    const messages: Message[] = [{
      id: 'm1', role: 'user', content: 'Que vois-tu ?', timestamp: 1, files: [image('a', 'image/jpeg')],
    }]
    await expect(buildTextOnlyMessages(messages)).resolves.toEqual([
      { role: 'user', content: '[Fichier joint: a.jpg]\nQue vois-tu ?' },
    ])
  })
})
