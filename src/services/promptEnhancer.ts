import {
  getAnthropicKey,
  getMistralKey,
  hasAnthropicKey,
  hasMistralKey,
} from './activeApiKey'
import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'
import { getEnhancerModel } from './promptEnhancerSettings'
import i18n from '../i18n'

const SYSTEM_PROMPT =
  "Ton unique tâche est de reformuler le texte brut que l'utilisateur t'envoie en un prompt plus clair et plus efficace pour une IA. " +
  "Peu importe la nature du texte (salutation, question, ordre, phrase incomplète), tu dois TOUJOURS retourner une version améliorée de CE texte. " +
  "Tu ne réponds JAMAIS au texte, tu ne le commentes JAMAIS, tu ne poses JAMAIS de question. " +
  "Tu retournes UNIQUEMENT le texte reformulé, sans guillemets, sans préfixe, sans explication, dans la même langue que l'original."

/**
 * Reformulates a user prompt via a cheap model (Haiku or Mistral Small).
 * Used by the ✨ button in InputBar. Returns the enhanced text on success,
 * throws with an i18n error message on failure.
 */
export async function enhancePrompt(text: string): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return text

  const model = getEnhancerModel()
  if (model === 'mistral' && hasMistralKey()) {
    return enhanceViaMistral(trimmed)
  }
  return enhanceViaHaiku(trimmed)
}

/** Returns true if the enhancer has at least one usable AI key. */
export function canEnhancePrompt(): boolean {
  return hasAnthropicKey() || hasMistralKey()
}

async function enhanceViaHaiku(text: string): Promise<string> {
  const apiKey = getAnthropicKey()
  const googleToken = await getValidAccessToken()

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  // 'server-provided' is a placeholder for whitelisted users without BYOK.
  // Never forward it — the proxy falls back to the server key itself (BUG 25).
  if (apiKey && apiKey !== 'server-provided') {
    headers['x-api-key'] = apiKey
  }
  if (googleToken) {
    headers['x-google-token'] = googleToken
  }

  const res = await fetch(apiUrl('/api/ai/proxy'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
  })

  if (!res.ok) {
    throw new Error(i18n.t('errors.promptEnhancementFailed'))
  }

  const data = await safeJson(res)
  const content = (data.content as Array<{ text?: string }> | undefined)?.[0]?.text
  if (!content) {
    throw new Error(i18n.t('errors.promptEnhancementFailed'))
  }
  return content.trim()
}

async function enhanceViaMistral(text: string): Promise<string> {
  const apiKey = getMistralKey()
  const googleToken = await getValidAccessToken()

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  if (googleToken) {
    headers['x-google-token'] = googleToken
  }

  const res = await fetch(apiUrl('/api/ai/mistral-proxy'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'mistral-small-latest',
      max_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  })

  if (!res.ok) {
    throw new Error(i18n.t('errors.promptEnhancementFailed'))
  }

  const data = await safeJson(res)
  const content = (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]
    ?.message?.content
  if (!content) {
    throw new Error(i18n.t('errors.promptEnhancementFailed'))
  }
  return content.trim()
}
