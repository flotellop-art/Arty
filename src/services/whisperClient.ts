/**
 * Audio transcription client.
 *
 * Défaut : Mistral Voxtral (serveurs en France) via `/api/ai/voxtral-proxy` —
 * meilleur en français (WER 3,24 % vs 4,48 % gpt-4o-mini-transcribe sur
 * FLEURS) et 2× moins cher que Whisper (0,003 $/min vs 0,006 $). Utilisé
 * pour les conversations EU (strict, jamais de fallback US) ET comme défaut
 * hors EU (clé serveur ou BYOK Mistral).
 *
 * Whisper (OpenAI, US) reste pour : BYOK OpenAI sans clé Mistral (appel
 * direct, comportement historique) et comme filet de secours hors EU si
 * Voxtral est indisponible (5xx / réseau).
 *
 * Toujours via le proxy pour Voxtral, jamais en direct navigateur (BUG 30 :
 * même contrat que mistralClient, BYOK forwardé en Bearer).
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

/** Erreur HTTP avec le status attaché — sert au routage du fallback. */
interface HttpError extends Error {
  status?: number
}

async function postWhisper(url: string, headers: Record<string, string>, formData: FormData): Promise<string> {
  const res = await fetch(url, { method: 'POST', headers, body: formData })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    const err: HttpError = new Error(formatWhisperError(res.status, errText))
    err.status = res.status
    throw err
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

/** Dictée Voxtral (Mistral, France) via le proxy — EU et défaut hors EU. */
async function transcribeVoxtral(audioBlob: Blob): Promise<string> {
  const googleToken = await getValidAccessToken()
  if (!googleToken) {
    const err: HttpError = new Error(i18n.t('chat.input.voice.googleRequired'))
    err.status = 401
    throw err
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

function transcribeOpenAIDirect(audioBlob: Blob, byokKey: string): Promise<string> {
  return transcribeWithFallback(
    'https://api.openai.com/v1/audio/transcriptions',
    { Authorization: `Bearer ${byokKey}` },
    audioBlob,
  )
}

export async function transcribeAudio(audioBlob: Blob, opts?: { euOnly?: boolean }): Promise<string> {
  // Promesse EU : l'audio d'une conversation euOnly ne part JAMAIS chez
  // OpenAI (US) — Voxtral strict, sans filet de secours Whisper.
  if (opts?.euOnly) {
    return transcribeVoxtral(audioBlob)
  }

  const mistralByok = getMistralKey()
  const openaiByok = getOpenAIKey()

  // BYOK OpenAI sans clé Mistral : appel direct OpenAI sur SA clé
  // (comportement historique — pas de quota serveur, pas de login requis).
  if (openaiByok && !mistralByok) {
    return transcribeOpenAIDirect(audioBlob, openaiByok)
  }

  // Défaut : Voxtral (clé serveur ou BYOK Mistral) — meilleur en français
  // et 2× moins cher que Whisper.
  try {
    return await transcribeVoxtral(audioBlob)
  } catch (err) {
    const status = (err as HttpError).status
    // 5xx / réseau = incident Mistral → filet de secours. Les 4xx (quota,
    // trial, taille) sont définitifs : Whisper répondrait pareil, on surface.
    const transient = status === undefined || status >= 500
    if (openaiByok && (transient || status === 401)) {
      // 401 inclus : token Google manquant/refusé, mais l'utilisateur a une
      // clé OpenAI à lui qui n'en a pas besoin.
      console.warn('[voxtral] indisponible, fallback OpenAI direct (BYOK):', err)
      return transcribeOpenAIDirect(audioBlob, openaiByok)
    }
    if (!transient) throw err
    console.warn('[voxtral] indisponible, fallback proxy Whisper:', err)
    const googleToken = await getValidAccessToken()
    if (!googleToken) throw err
    return transcribeWithFallback(
      apiUrl('/api/ai/whisper-proxy'),
      { 'x-google-token': googleToken },
      audioBlob,
    )
  }
}
