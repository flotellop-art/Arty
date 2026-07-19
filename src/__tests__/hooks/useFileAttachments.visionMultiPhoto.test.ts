import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({
  getFile: vi.fn(),
}))

vi.mock('../../services/secureFileStorage', () => ({
  getFile: storageMocks.getFile,
}))

import { buildContentBlocks } from '../../hooks/useFileAttachments'

describe('hydrateFiles — lots canoniques 4K', () => {
  beforeEach(() => {
    storageMocks.getFile.mockReset()
  })

  it('déchiffre les photos canoniques une par une et conserve leur ordre', async () => {
    let active = 0
    let peak = 0
    storageMocks.getFile.mockImplementation(async (id: string) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return {
        id,
        name: `${id}.jpg`,
        type: 'image/jpeg',
        data: `base64-${id}`,
        size: 1024,
        width: 4096,
        height: 3072,
        normalizationVersion: 2,
      }
    })

    const blocks = await buildContentBlocks('Analyse-les', ['a', 'b', 'c', 'd'].map((id) => ({
      id,
      name: `${id}.jpg`,
      type: 'image/jpeg',
      size: 1024,
      width: 4096,
      height: 3072,
      normalizationVersion: 2,
    })))

    expect(peak).toBe(1)
    expect(storageMocks.getFile.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c', 'd'])
    expect(blocks.slice(0, 4).map((block) => block.source)).toEqual([
      { type: 'base64', media_type: 'image/jpeg', data: 'base64-a' },
      { type: 'base64', media_type: 'image/jpeg', data: 'base64-b' },
      { type: 'base64', media_type: 'image/jpeg', data: 'base64-c' },
      { type: 'base64', media_type: 'image/jpeg', data: 'base64-d' },
    ])
  })

  it('laisse les PDF historiques sur leur hydratation parallèle existante', async () => {
    let active = 0
    let peak = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    storageMocks.getFile.mockImplementation(async (id: string) => {
      active += 1
      peak = Math.max(peak, active)
      await gate
      active -= 1
      return {
        id,
        name: `${id}.pdf`,
        type: 'application/pdf',
        data: `pdf-${id}`,
      }
    })

    const pending = buildContentBlocks('Résume-les', ['a', 'b'].map((id) => ({
      id,
      name: `${id}.pdf`,
      type: 'application/pdf',
    })))
    await vi.waitFor(() => expect(peak).toBe(2))
    release()
    await pending
  })
})
