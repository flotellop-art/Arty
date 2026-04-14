/**
 * OpenAI Whisper audio transcription client.
 * Uses the user's BYOK OpenAI API key.
 */

import { getOpenAIKey } from './activeApiKey'

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('Clé OpenAI manquante — impossible de transcrire')
  }

  const formData = new FormData()
  formData.append('file', audioBlob, 'recording.webm')
  formData.append('model', 'whisper-1')
  formData.append('language', 'fr')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Whisper error: ${res.status} ${errText}`)
  }

  const data = (await res.json()) as { text?: string }
  return data.text || ''
}
