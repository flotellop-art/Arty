/**
 * OpenAI Whisper audio transcription client.
 * Uses the user's BYOK OpenAI API key.
 */

import { getOpenAIKey } from './activeApiKey'
import i18n from '../i18n'

// Extension map aligned with common MediaRecorder mime types, so the filename
// hint sent to Whisper matches the container — Whisper infers codec from both
// the bytes and the filename extension; a `.webm` name with `audio/mp4` bytes
// can trip the decoder.
function pickFilename(blob: Blob): string {
  const t = (blob.type || '').toLowerCase()
  if (t.includes('mp4')) return 'recording.mp4'
  if (t.includes('mpeg') || t.includes('mp3')) return 'recording.mp3'
  if (t.includes('ogg')) return 'recording.ogg'
  if (t.includes('wav')) return 'recording.wav'
  return 'recording.webm'
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const apiKey = getOpenAIKey()
  if (!apiKey) {
    throw new Error('Clé OpenAI manquante — impossible de transcrire')
  }

  const formData = new FormData()
  formData.append('file', audioBlob, pickFilename(audioBlob))
  formData.append('model', 'whisper-1')
  const lng = (i18n.resolvedLanguage || i18n.language || 'fr').slice(0, 2)
  formData.append('language', lng)

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
