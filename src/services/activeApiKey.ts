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
  return _anthropicKey || import.meta.env.VITE_ANTHROPIC_API_KEY || null
}

export function getGeminiKey(): string | null {
  return _geminiKey || import.meta.env.VITE_GEMINI_API_KEY || null
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
