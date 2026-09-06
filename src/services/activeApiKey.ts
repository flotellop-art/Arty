/**
 * Singleton for the active user's API keys.
 * Set at login, cleared at logout.
 */
import { getActiveUserId, getActiveSessionEpoch } from './userSession'

let _anthropicKey: string | null = null
let _geminiKey: string | null = null
let _mistralKey: string | null = null
let _openaiKey: string | null = null
let installation: { owner: string | null; epoch: number } | null = null
let installationGeneration = 0
const changed = () => { try { window.dispatchEvent(new Event('arty-active-keys-changed')) } catch { /* no DOM */ } }

/** Metadata proof only; the existing transport getters remain unchanged. */
export function captureActiveKeysInstallation() {
  const captured = installation, generation = installationGeneration
  const isCurrent = () => captured !== null && captured.owner !== null && captured === installation &&
    generation === installationGeneration && captured.owner === getActiveUserId() && captured.epoch === getActiveSessionEpoch()
  return { ready: isCurrent(), isCurrent }
}

export function setActiveKeys(
  anthropic: string,
  gemini?: string,
  mistral?: string,
  openai?: string
): void {
  _anthropicKey = anthropic
  _geminiKey = gemini || null
  _mistralKey = mistral || null
  _openaiKey = openai || null
  installation = { owner: getActiveUserId(), epoch: getActiveSessionEpoch() }; installationGeneration++; changed()
}

export function getAnthropicKey(): string | null {
  return _anthropicKey || null
}

export function getGeminiKey(): string | null {
  return _geminiKey || null
}

export function getMistralKey(): string | null {
  return _mistralKey || null
}

export function getOpenAIKey(): string | null {
  return _openaiKey || null
}

export function clearActiveKeys(): void {
  _anthropicKey = null
  _geminiKey = null
  _mistralKey = null
  _openaiKey = null
  installation = null; installationGeneration++; changed()
}

export function hasAnthropicKey(): boolean {
  return !!getAnthropicKey()
}

export function hasMistralKey(): boolean {
  return !!getMistralKey()
}

export function hasOpenAIKey(): boolean {
  return !!getOpenAIKey()
}
