import type { QualifiedSubsidizedRequest } from './anthropicSubsidizedRequest'
import type { UsageResponseFormat } from './trackUsage'

/** Separate financial proof: analytics/wallet parsers are not a refund oracle.
 * Contract: Anthropic Messages 2023-06-01, standard Haiku 4.5, web_search_20250305.
 * Sources and deliberately unsupported cases: docs/SUBSIDIZED_CHAT_GAP.md.
 */
export const ANTHROPIC_SUBSIDIZED_TARIFF = 'haiku45-standard-20260908-v1'
export type SubsidizedCostProof = Readonly<{
  responseId: string
  tariff: typeof ANTHROPIC_SUBSIDIZED_TARIFF
  costMicroUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  searches: number
  requestBoundsExceeded: boolean
}>
type Obj = Record<string, unknown>
const object = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const count = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0
const STOPS = new Set(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal'])
const USAGE_KEYS = new Set(['input_tokens', 'output_tokens', 'cache_read_input_tokens',
  'cache_creation_input_tokens', 'cache_creation', 'server_tool_use', 'service_tier', 'inference_geo', 'output_tokens_details'])
const MAX_BUFFER = 4 * 1024 * 1024

export function createAnthropicSubsidizedUsageParser(
  format: UsageResponseFormat, contract: QualifiedSubsidizedRequest['costContract'],
) {
  let buffer = '', dataLines: string[] = [], eventName = '', responseId = ''
  let bad = false, started = false, terminal = false, stopped = false, finalized = false
  let finalSearch = false
  let deltasStarted = false, sawOutputDelta = false, stopReason: string | null = null
  const usage: Obj = {}
  const blocks = new Set<number>()

  function patchUsage(value: unknown, isTerminal: boolean) {
    if (!object(value) || Object.keys(value).some(k => !USAGE_KEYS.has(k))) { bad = true; return }
    for (const [key, next] of Object.entries(value)) {
      // Official nullable counters in deltas mean no update, never zero.
      if (next === null && key !== 'output_tokens') continue
      // Official read-only decomposition of output_tokens, already inclusive.
      if (key === 'output_tokens_details') {
        if (!object(next)) bad = true
        continue
      }
      if (key === 'cache_creation' || key === 'server_tool_use') {
        if (!object(next)) { bad = true; continue }
        const allowed = key === 'cache_creation'
          ? ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']
          : ['web_search_requests', 'web_fetch_requests']
        if (Object.keys(next).some(k => !allowed.includes(k))) bad = true
        const previous = object(usage[key]) ? usage[key] as Obj : {}
        for (const [k, n] of Object.entries(next)) {
          if (!count(n) || (count(previous[k]) && n < previous[k])) bad = true
          previous[k] = n
        }
        usage[key] = previous
        if (key === 'server_tool_use' && isTerminal && count(next.web_search_requests)) finalSearch = true
      } else if (key === 'service_tier' || key === 'inference_geo') {
        if (next !== (key === 'service_tier' ? 'standard' : 'global') && next !== null) bad = true
        usage[key] = next
      } else {
        if (!count(next) || (count(usage[key]) && next < usage[key])) bad = true
        usage[key] = next
      }
    }
  }
  function start(value: unknown) {
    if (started || !object(value) || value.type !== 'message' || value.role !== 'assistant'
      || value.model !== contract.model || typeof value.id !== 'string'
      || !/^msg_[a-zA-Z0-9_-]{1,120}$/.test(value.id)) { bad = true; return }
    started = true; responseId = value.id
    patchUsage(value.usage, format === 'json')
    if (format === 'json') {
      if (!STOPS.has(value.stop_reason as string) || !Array.isArray(value.content)) bad = true
      terminal = true; stopped = true
    } else if (value.stop_reason !== null) bad = true
  }
  function consume(raw: string, event = '') {
    let p: unknown
    try { p = JSON.parse(raw) } catch { bad = true; return }
    if (!object(p)) { bad = true; return }
    if (format === 'json') { start(p); return }
    if (event && event !== p.type) bad = true
    if (p.type === 'ping') return
    if (stopped) { bad = true; return }
    if (p.type === 'message_start') { start(p.message); return }
    if (!started) { bad = true; return }
    if (p.type === 'content_block_start') {
      if (deltasStarted || !count(p.index) || blocks.has(p.index)) bad = true
      else blocks.add(p.index)
    } else if (p.type === 'content_block_delta') {
      if (deltasStarted || !count(p.index) || !blocks.has(p.index)) bad = true
    } else if (p.type === 'content_block_stop') {
      if (deltasStarted || !count(p.index) || !blocks.delete(p.index)) bad = true
    } else if (p.type === 'message_delta') {
      if (blocks.size || !object(p.delta) || !object(p.usage)) { bad = true; return }
      const reason = p.delta.stop_reason
      if (reason !== undefined && reason !== null) {
        if (!STOPS.has(reason as string) || (stopReason !== null && reason !== stopReason)) bad = true
        else { stopReason = reason as string; terminal = true }
      }
      if (count(p.usage.output_tokens)) sawOutputDelta = true
      patchUsage(p.usage, true); deltasStarted = true
    } else if (p.type === 'message_stop') {
      if (!terminal || !sawOutputDelta || blocks.size) bad = true
      stopped = true
    } else bad = true // errors and future unqualified events never authorize a release
  }
  function line(raw: string) {
    const s = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!s) {
      if (dataLines.length) consume(dataLines.join('\n'), eventName)
      dataLines = []; eventName = ''; return
    }
    if (s.startsWith(':')) return
    const colon = s.indexOf(':')
    const key = colon < 0 ? s : s.slice(0, colon)
    const value = colon < 0 ? '' : s.slice(colon + 1).replace(/^ /, '')
    if (key === 'data') dataLines.push(value)
    else if (key === 'event') eventName = value
    else if (key !== 'id' && key !== 'retry') bad = true
    if (dataLines.reduce((n, v) => n + v.length, 0) > MAX_BUFFER) bad = true
  }
  function feed(chunk: string) {
    if (finalized || bad) return
    // Replacement characters may indicate damaged UTF-8. Conservative refusal.
    if (chunk.includes('\uFFFD')) { bad = true; return }
    buffer += chunk
    if (format === 'sse') {
      let end: number
      while (!bad && (end = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      }
    }
    if (buffer.length > MAX_BUFFER) bad = true
  }
  function finalize(transportComplete: boolean): SubsidizedCostProof | null {
    if (finalized) return null
    finalized = true
    if (format === 'json') consume(buffer)
    else if (buffer.trim() || dataLines.length) bad = true // incomplete SSE frame
    if (!transportComplete || bad || !started || !terminal || !stopped) return null
    const input = usage.input_tokens, output = usage.output_tokens
    const read = usage.cache_read_input_tokens, write = usage.cache_creation_input_tokens
    if (![input, output, read, write].every(count)) return null
    let five = 0, hour = 0
    if (object(usage.cache_creation)) {
      if (!count(usage.cache_creation.ephemeral_5m_input_tokens)
        || !count(usage.cache_creation.ephemeral_1h_input_tokens)) return null
      five = usage.cache_creation.ephemeral_5m_input_tokens
      hour = usage.cache_creation.ephemeral_1h_input_tokens
    } else if (write !== 0) return null
    if (five + hour !== write) return null
    const tools = object(usage.server_tool_use) ? usage.server_tool_use : {}
    const searches = tools.web_search_requests ?? (contract.maxSearches === 0 ? 0 : undefined)
    if (!count(searches) || (contract.maxSearches > 0 && !finalSearch)
      || (tools.web_fetch_requests !== undefined && tools.web_fetch_requests !== 0)) return null
    const i = input as number, o = output as number, r = read as number
    const requestBoundsExceeded = searches > contract.maxSearches || o > contract.maxOutputTokens
      || BigInt(i) + BigInt(r) + BigInt(five) + BigInt(hour) > BigInt(200000 * (contract.maxSearches ? 10 : 1))
    // Integer twentieths of microUSD, rounded UP once, without wallet markup.
    const units = BigInt(i) * 20n + BigInt(o) * 100n + BigInt(r) * 2n
      + BigInt(five) * 25n + BigInt(hour) * 40n + BigInt(searches) * 200000n
    const cost = (units + 19n) / 20n
    if (cost > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Object.freeze({ responseId, tariff: ANTHROPIC_SUBSIDIZED_TARIFF,
      costMicroUsd: Number(cost), inputTokens: i, outputTokens: o, cacheReadTokens: r,
      cacheWrite5mTokens: five, cacheWrite1hTokens: hour, searches, requestBoundsExceeded })
  }
  return { feed, finalize }
}
