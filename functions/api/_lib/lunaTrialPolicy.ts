/** Bounded server-funded Luna text requests. Never trust client token limits. */
export function enforceLunaTrialPolicy(body: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(body)
  if (serialized.length > 65_536 || new TextEncoder().encode(serialized).byteLength > 65_536) return false
  if (!Array.isArray(body.messages) || body.messages.length === 0) return false
  const requested = body.max_completion_tokens ?? body.max_tokens ?? 4096
  if (typeof requested !== 'number' || !Number.isInteger(requested) || requested < 1) return false
  body.max_completion_tokens = Math.min(requested, 4096)
  delete body.max_tokens
  body.n = 1
  body.service_tier = 'default'
  body.store = false
  return new TextEncoder().encode(JSON.stringify(body)).byteLength <= 65_536
}
