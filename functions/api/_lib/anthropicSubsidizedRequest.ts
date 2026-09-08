import type { SubsidizedEnvelope } from './subsidizedBudget'

// This is a versioned provider-cost contract, NOT a spending authorization.
// Primary-source derivation and activation gates: docs/SUBSIDIZED_CHAT_GAP.md.
const MODEL = 'claude-haiku-4-5-20251001'
const ROOT_KEYS = new Set(['model', 'max_tokens', 'messages', 'system', 'tools', 'tool_choice',
  'stream', 'stop_sequences', 'temperature', 'top_p', 'top_k', 'metadata', 'cache_control',
  'service_tier'])
const BETAS = new Set(['pdfs-2024-09-25', 'prompt-caching-2024-07-31'])
const SEARCH_KEYS = new Set(['type', 'name', 'max_uses', 'allowed_domains', 'blocked_domains',
  'user_location', 'cache_control'])
const BLOCK_TYPES = new Set(['text', 'image', 'document', 'tool_use', 'tool_result', 'thinking',
  'redacted_thinking', 'server_tool_use', 'web_search_tool_result', 'web_search_result', 'search_result',
  'web_fetch_tool_result', 'code_execution_tool_result', 'bash_code_execution_tool_result',
  'text_editor_code_execution_tool_result'])
type ObjectValue = Record<string, unknown>
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value)
const keysWithin = (value: ObjectValue, allowed: Set<string>) => Object.keys(value).every(key => allowed.has(key))
function validCache(value: unknown): boolean {
  return value === undefined || (object(value) && Object.keys(value).every(k => k === 'type' || k === 'ttl')
    && value.type === 'ephemeral' && (value.ttl === undefined || value.ttl === '5m' || value.ttl === '1h'))
}

// Only visit API content positions, never tool input/schema/user JSON. Preserve
// all bytes of encrypted search state, signatures, images and documents.
function validBlocks(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return true
  if (!Array.isArray(value) || depth > 64) return false
  return value.every(block => {
    if (!object(block) || typeof block.type !== 'string' || !BLOCK_TYPES.has(block.type)
      || !validCache(block.cache_control)) return false
    // Native search errors are objects (max_uses_exceeded etc.), not blocks.
    if (block.type === 'web_search_tool_result') return Array.isArray(block.content)
      ? validBlocks(block.content, depth + 1)
      : object(block.content) && block.content.type === 'web_search_tool_result_error'
    if (block.type === 'tool_result' && block.content !== undefined && !validBlocks(block.content, depth + 1)) return false
    if (block.type === 'document' && object(block.source) && block.source.type === 'content'
      && !validBlocks(block.source.content, depth + 1)) return false
    return true
  })
}

const SERVER_RESULTS: Readonly<Record<string, string>> = {
  web_search: 'web_search_tool_result', web_fetch: 'web_fetch_tool_result',
  code_execution: 'code_execution_tool_result', bash_code_execution: 'bash_code_execution_tool_result',
  text_editor_code_execution: 'text_editor_code_execution_tool_result',
}
const RESULT_TYPES = new Set(Object.values(SERVER_RESULTS))
function validServerHistory(messages: ObjectValue[], searches: number): boolean {
  const calls = new Map<string, { name: string; complete: boolean }>()
  const results = new Set<string>()
  // Deferred results can arrive in a LATER assistant message. User data and
  // nested tool_result content can never close a pending server capability.
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content as ObjectValue[]) {
      if (block.type === 'server_tool_use') {
        if (typeof block.id !== 'string' || !block.id || calls.has(block.id) || results.has(block.id)
          || typeof block.name !== 'string' || !Object.hasOwn(SERVER_RESULTS, block.name)) return false
        calls.set(block.id, { name: block.name, complete: false })
      } else if (RESULT_TYPES.has(block.type as string)) {
        if (typeof block.tool_use_id !== 'string' || !block.tool_use_id || results.has(block.tool_use_id)) return false
        results.add(block.tool_use_id)
        const call = calls.get(block.tool_use_id)
        if (call) {
          if (block.type !== SERVER_RESULTS[call.name]) return false
          call.complete = true
        }
      }
    }
  }
  return [...calls.values()].every(call => call.complete || (call.name === 'web_search' && searches > 0))
}

function validToolChoice(value: unknown): boolean {
  if (value === undefined) return true
  return object(value) && Object.keys(value).every(k => ['type', 'name', 'disable_parallel_tool_use'].includes(k))
    && ['auto', 'any', 'none', 'tool'].includes(value.type as string)
    && (value.type !== 'tool' || typeof value.name === 'string')
}

export type QualifiedSubsidizedRequest = Readonly<{
  body: string
  envelope: SubsidizedEnvelope
  costContract: Readonly<{ model: string; maxOutputTokens: number; maxSearches: number }>
}>

/** Call only AFTER plan/wallet selection and final served-model alignment.
 * Unknown cost modifiers are refused, never silently stripped. The two
 * normalizations keep the same model and standard price (no priority tier).
 * Serialization binds the envelope to one immutable request before any await.
 */
export function qualifyAnthropicSubsidizedRequest(
  body: ObjectValue, headers: Readonly<Record<string, string>>,
): QualifiedSubsidizedRequest | null {
  if (!keysWithin(body, ROOT_KEYS) || (body.model !== MODEL && body.model !== 'claude-haiku-4-5')
    || !Number.isSafeInteger(body.max_tokens) || (body.max_tokens as number) < 1 || (body.max_tokens as number) > 64000
    || headers['anthropic-version'] !== '2023-06-01'
    || (headers['anthropic-beta'] !== undefined && !headers['anthropic-beta'].split(',').every(b => BETAS.has(b.trim())))
    || !validCache(body.cache_control)
    || !validToolChoice(body.tool_choice)
    || (body.service_tier !== undefined && body.service_tier !== 'auto' && body.service_tier !== 'standard_only')
    || (body.system !== undefined && !validBlocks(body.system))
    || !Array.isArray(body.messages) || body.messages.length === 0
    || !body.messages.every(m => object(m) && Object.keys(m).every(k => k === 'role' || k === 'content')
      && (m.role === 'user' || m.role === 'assistant') && validBlocks(m.content))) return null

  let searches = 0
  const names = new Set<string>()
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) return null
    for (const tool of body.tools) {
      if (!object(tool) || typeof tool.name !== 'string' || !tool.name || names.has(tool.name) || !validCache(tool.cache_control)) return null
      names.add(tool.name)
      if (tool.type === 'web_search_20250305') {
        if (!keysWithin(tool, SEARCH_KEYS) || tool.name !== 'web_search' || !Number.isSafeInteger(tool.max_uses)
          || (tool.max_uses as number) < 1 || (tool.max_uses as number) > 5) return null
        searches = tool.max_uses as number
      } else return null // The free offer only exposes native web search.
    }
  }
  if (!validServerHistory(body.messages as ObjectValue[], searches)) return null
  // Offer limits apply only to the final subsidized branch, per HTTP attempt.
  // Keep validation above and preserve the caller's history and tool schemas.
  const maxOutputTokens = Math.min(body.max_tokens as number, 2000)
  searches = Math.min(searches, 1)
  const tools = (body.tools as ObjectValue[] | undefined)?.map(tool =>
    tool.type === 'web_search_20250305' ? { ...tool, max_uses: searches } : tool)
  // Native search can re-infer after errors, even after max_uses is reached.
  // Its DOCUMENTED sampling cap is 10/request, not max_uses + 1. Charge every
  // input token at the worst supported rate (1h write = 2 microUSD/token).
  // max_tokens bounds total generated output/request at 5 microUSD/token.
  const iterations = searches ? 10 : 1
  const ceilingMicroUsd = iterations * 200000 * 2 + maxOutputTokens * 5 + searches * 10000
  return Object.freeze({
    body: JSON.stringify({ ...body, model: MODEL, max_tokens: maxOutputTokens,
      ...(tools ? { tools } : {}), service_tier: 'standard_only' }),
    costContract: Object.freeze({ model: MODEL, maxOutputTokens, maxSearches: searches }),
    envelope: Object.freeze({ policyRevision: 1, ceilingMicroUsd,
      envelopeId: `anthropic:haiku45:200k:${iterations}loops:${maxOutputTokens}out:${searches}search:20260908:v2` }),
  })
}
