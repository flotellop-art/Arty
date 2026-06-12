/**
 * Audio transcription client.
 *
 * Route standard : OpenAI Whisper — BYOK direct, sinon proxy serveur
 * `/api/ai/whisper-proxy` (clé OPENAI_API_KEY du owner, whitelist/plan).
 *
 * Route EU (`euOnly`) : Mistral Voxtral (serveurs en France) via le proxy
 * `/api/ai/voxtral-proxy` — l'audio d'une conversation EU ne part JAMAIS
 * chez OpenAI (US). Toujours via le proxy, jamais en direct navigateur
 * (BUG 30 : même contrat que mistralClient, BYOK forwardé en Bearer).
 */

import { getMistralKey, getOpenAIKey } from './activeApiKey'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'
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

// Surface the actual OpenAI / proxy error ("insufficient_quota", "model does
// not exist", "email not whitelisted") instead of the opaque `Whisper error:
// 400`. Callers catch and display err.message in the banner.
function formatWhisperError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string } | string
      // Forme d'erreur Mistral (Voxtral) : message au top-level.
      message?: string
    }
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error
    if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
      return parsed.error.message
    }
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
  } catch {
    // Not JSON — fall through.
  }
  return `Transcription error ${status}${body ? ` — ${body.slice(0, 200)}` : ''}`
}

async function postWhisper(url: string, headers: Record<string, string>, formData: FormData): Promise<string> {
  const res = await fetch(url, { method: 'POST', headers, body: formData })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(formatWhisperError(res.status, errText))
  }
  const data = (await res.json()) as { text?: string }
  return data.text || ''
}

function buildFormData(audioBlob: Blob, model: string, opts?: { verboseJson?: boolean }): FormData {
  const formData = new FormData()
  formData.append('file', audioBlob, pickFilename(audioBlob))
  formData.append('model', model)
  const lng = (i18n.resolvedLanguage || i18n.language || 'fr').slice(0, 2)
  formData.append('language', lng)
  if (opts?.verboseJson) {
    // verbose_json (OpenAI uniquement) : inclut toujours `text` + `duration`
    // que le proxy serveur utilise pour calculer le coût Whisper précis.
    // Voxtral n'a pas ce champ — la durée arrive dans usage.prompt_audio_seconds.
    formData.append('response_format', 'verbose_json')
  }
  return formData
}

// gpt-4o-transcribe is newer and gated by account tier — some OpenAI accounts
// see 400/404 "model does not exist". Fall back to whisper-1 (universal paid
// tier). Keeps the quality upgrade for accounts that have it while making the
// feature work out of the box everywhere else.
async function transcribeWithFallback(url: string, headers: Record<string, string>, audioBlob: Blob): Promise<string> {
  try {
    return await postWhisper(url, headers, buildFormData(audioBlob, 'gpt-4o-transcribe', { verboseJson: true }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    const modelRejected = /model|not.?found|does.?not.?exist|unknown|invalid.*model/i.test(msg)
    if (!modelRejected) throw err
    console.warn('[whisper] gpt-4o-transcribe rejected, retrying with whisper-1:', msg)
    return await postWhisper(url, headers, buildFormData(audioBlob, 'whisper-1', { verboseJson: true }))
  }
}

/** Dictée EU : Voxtral (Mistral, France) via le proxy. Jamais OpenAI. */
async function transcribeAudioEU(audioBlob: Blob): Promise<string> {
  const googleToken = await getValidAccessToken()
  if (!googleToken) {
    throw new Error(i18n.t('chat.input.voice.euAuthRequired'))
  }

  const headers: Record<string, string> = { 'x-google-token': googleToken }
  // BYOK Mistral forwardé en Bearer — le proxy l'utilise à la place de la
  // clé serveur (même contrat que mistral-proxy).
  const byokKey = getMistralKey()
  if (byokKey) headers['Authorization'] = `Bearer ${byokKey}`

  return postWhisper(
    apiUrl('/api/ai/voxtral-proxy'),
    headers,
    buildFormData(audioBlob, 'voxtral-mini-latest'),
  )
}

export async function transcribeAudio(audioBlob: Blob, opts?: { euOnly?: boolean }): Promise<string> {
  // Promesse EU : l'audio d'une conversation euOnly ne part jamais chez
  // OpenAI (US) — transcription Mistral Voxtral (serveurs en France).
  if (opts?.euOnly) {
    return transcribeAudioEU(audioBlob)
  }

  const byokKey = getOpenAIKey()

  // BYOK : appel direct OpenAI (latence plus faible, pas de quota serveur)
  if (byokKey) {
    return transcribeWithFallback(
      'https://api.openai.com/v1/audio/transcriptions',
      { Authorization: `Bearer ${byokKey}` },
      audioBlob,
    )
  }

  // Fallback serveur : nécessite un token Google (whitelist côté proxy).
  const googleToken = await getValidAccessToken()
  if (!googleToken) {
    throw new Error('Clé OpenAI manquante — connecte-toi avec Google ou ajoute ta clé')
  }

  return transcribeWithFallback(
    apiUrl('/api/ai/whisper-proxy'),
    { 'x-google-token': googleToken },
    audioBlob,
  )
}
