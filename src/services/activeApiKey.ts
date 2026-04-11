/**
 * Singleton for the active user's API keys.
 * Set at login, cleared at logout.
 */

let _anthropicKey: string | null = null
let _geminiKey: string | null = null
let _mistralKey: string | null = null

export function setActiveKeys(anthropic: string, gemini?: string, mistral?: string): void {
  _anthropicKey = anthropic
  _geminiKey = gemini || null
  _mistralKey = mistral || null
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

export function clearActiveKeys(): void {
  _anthropicKey = null
  _geminiKey = null
  _mistralKey = null
}

export function hasAnthropicKey(): boolean {
  return !!getAnthropicKey()
}

export function hasMistralKey(): boolean {
  return !!getMistralKey()
}
