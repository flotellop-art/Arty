import { describe, expect, it } from 'vitest'
import { buildOpenAIRouteMessages } from '../../hooks/openaiRouteMessages'
import type { FileAttachment, Message } from '../../types'

const photo: FileAttachment = {
  id: 'photo-1',
  name: 'chantier.jpg',
  type: 'image/jpeg',
  data: 'AA==',
  size: 1,
  width: 4096,
  height: 3072,
  normalizationVersion: 2,
}

const history: Message[] = [{
  id: 'user-1',
  role: 'user',
  content: 'Analyse-la',
  timestamp: 1,
  files: [photo],
}]

describe('buildOpenAIRouteMessages — jonction routeur/builder', () => {
  it('usesOpenAIVision=true construit réellement les blocs Terra 4K', async () => {
    const result = await buildOpenAIRouteMessages({
      history,
      routeDecision: { usesOpenAIVision: true },
      currentFiles: [photo],
      outgoingText: 'Analyse-la',
      modelText: 'Analyse-la',
    })

    expect(result.consumedCurrentFiles).toBe(true)
    expect(result.messages[0]?.content).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,AA==', detail: 'original' },
      },
      { type: 'text', text: 'Analyse-la' },
    ])
  })

  it('usesOpenAIVision=false ne reconstruit jamais la décision depuis les fichiers', async () => {
    const result = await buildOpenAIRouteMessages({
      history,
      routeDecision: { usesOpenAIVision: false },
      currentFiles: [photo],
      outgoingText: 'Analyse-la',
      modelText: 'Analyse-la',
    })

    expect(result.consumedCurrentFiles).toBe(false)
    expect(result.messages[0]?.content).toBe('[Fichier joint: chantier.jpg]\nAnalyse-la')
  })
})
