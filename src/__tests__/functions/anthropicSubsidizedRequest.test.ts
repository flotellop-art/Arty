import { describe, expect, it } from 'vitest'
import { qualifyAnthropicSubsidizedRequest as qualify } from '../../../functions/api/_lib/anthropicSubsidizedRequest'
import { alignBodyWithServedModel } from '../../../functions/api/ai/proxy'
import { TOOLS } from '../../services/toolDefinitions'

const headers = { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'pdfs-2024-09-25,prompt-caching-2024-07-31' }
const search = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
const payload = () => ({ model: 'claude-haiku-4-5-20251001', max_tokens: 64000, stream: true,
  system: [{ type: 'text', text: 'Synthetic system', cache_control: { type: 'ephemeral' } }],
  tools: [search], messages: [{ role: 'user', content: 'Synthetic search' }] })

describe('qualified native-search provider envelope (not an operator budget)', () => {
  it('preserves real client tools and freezes serialization before any later mutation', () => {
    // The qualifier's contract starts AFTER the real final Haiku alignment.
    const original = JSON.parse(alignBodyWithServedModel(JSON.stringify({ ...payload(), tools: TOOLS }), payload().model))
    const snapshot = JSON.stringify(original)
    const result = qualify(original, headers)!
    expect(result).not.toBeNull()
    expect(result.envelope.ceilingMicroUsd).toBe(4370000)
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.envelope)).toBe(true)
    expect(JSON.parse(result.body)).toEqual({ ...original, service_tier: 'standard_only' })
    expect(JSON.stringify(original)).toBe(snapshot)
    original.max_tokens = 1
    expect(JSON.parse(result.body).max_tokens).toBe(64000)
  })
  it('uses one inference without native tools, not a search envelope or a byte/token guess', () => {
    const result = qualify({ ...payload(), tools: [], max_tokens: 123 }, headers)!
    expect(result.envelope.ceilingMicroUsd).toBe(400615)
  })
  it('pins the documented alias and the standard tier without discarding content', () => {
    const result = qualify({ ...payload(), model: 'claude-haiku-4-5', service_tier: 'auto' }, headers)!
    expect(JSON.parse(result.body)).toMatchObject({ model: 'claude-haiku-4-5-20251001', service_tier: 'standard_only' })
  })
  it.each([
    { model: 'fake-haiku-premium' }, { model: 'claude-haiku-3-5' }, { max_tokens: 64001 },
    { max_tokens: 0 }, { max_tokens: '64000' }, { max_tokens: 1.5 }, { max_tokens: Number.NaN },
    { container: 'unqualified' }, { mcp_servers: [] }, { context_management: {} },
    { speed: 'fast' }, { inference_geo: 'us' }, { inference_geo: 'global' }, { service_tier: 'priority' },
    { cache_control: { type: 'ephemeral', ttl: '24h' } }, { tool_choice: { type: 'advisor' } },
  ])('refuses an unqualified model, modifier or output bound: %j', mutation => {
    expect(qualify({ ...payload(), ...mutation }, headers)).toBeNull()
  })
  it.each(['web_search_20260209', 'web_fetch_20250910', 'code_execution_20250825', 'advisor_20260301'])('refuses another native tool %s', type => {
    expect(qualify({ ...payload(), tools: [{ type, name: 'extension', input_schema: {} }] }, headers)).toBeNull()
  })
  it.each([undefined, 0, 6, 1.1, '5'])('requires an explicit bounded search count: %s', max_uses => {
    expect(qualify({ ...payload(), tools: [{ ...search, max_uses }] }, headers)).toBeNull()
  })
  it.each(['web_search', 'web_fetch', 'code_execution'])('refuses ambiguous custom tool %s', name => {
    expect(qualify({ ...payload(), tools: [{ name, input_schema: {} }] }, headers)).toBeNull()
  })
  it('refuses duplicate tool names and unqualified header extensions', () => {
    expect(qualify({ ...payload(), tools: [search, search] }, headers)).toBeNull()
    expect(qualify(payload(), { ...headers, 'anthropic-version': 'future' })).toBeNull()
    expect(qualify(payload(), { ...headers, 'anthropic-beta': headers['anthropic-beta'] + ',unknown-loop-beta' })).toBeNull()
  })
  it('preserves encrypted search, error, thinking and completed historical non-search blocks exactly', () => {
    const history = [{ role: 'assistant', content: [
      { type: 'thinking', thinking: 'synthetic', signature: 'do-not-rewrite' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'synthetic' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result',
        url: 'https://example.test', title: 'Synthetic', encrypted_content: 'EXACT+/=' }] },
      { type: 'web_search_tool_result', tool_use_id: 's2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      { type: 'server_tool_use', id: 'old', name: 'code_execution', input: { code: 'historical' } },
      { type: 'code_execution_tool_result', tool_use_id: 'old', content: { type: 'code_execution_result', stdout: 'done' } },
    ] }, { role: 'user', content: 'Continue' }]
    const result = qualify({ ...payload(), messages: history }, headers)!
    expect(result).not.toBeNull(); expect(JSON.parse(result.body).messages).toEqual(history)
    expect(result.envelope.ceilingMicroUsd).toBe(4370000)
  })
  it('prices deferred native search in this new request, preserving the pending block', () => {
    const messages = [{ role: 'assistant', content: [
      { type: 'server_tool_use', id: 'pending', name: 'web_search', input: { query: 'synthetic' } },
      { type: 'tool_use', id: 'client', name: 'local', input: {} },
    ] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'client', content: 'ok' }] }]
    const result = qualify({ ...payload(), messages }, headers)!
    expect(result).not.toBeNull(); expect(JSON.parse(result.body).messages).toEqual(messages)
    expect(result.envelope.ceilingMicroUsd).toBe(4370000)
    messages[0].content[0].name = 'code_execution'
    expect(qualify({ ...payload(), messages }, headers)).toBeNull()
  })
  it('validates cache in content positions, never inside business input or schemas', () => {
    const messages = [{ role: 'assistant', content: [{ type: 'tool_use', name: 'local', id: 'c',
      input: { cache_control: { ttl: 'business-value' } } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', cache_control: { type: 'ephemeral', ttl: '1h' },
      content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'c3ludGhldGlj' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'c3ludGhldGlj' } }] }] }]
    const tools = [search, { name: 'local', input_schema: { properties: { cache_control: { type: 'string' } } } }]
    const result = qualify({ ...payload(), messages, tools }, headers)!
    expect(result).not.toBeNull(); expect(JSON.parse(result.body).messages).toEqual(messages)
    expect(JSON.parse(result.body).tools).toEqual(tools)
  })
  it('recognizes a completed historical server action across different assistant messages', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'server_tool_use', id: 'old', name: 'web_fetch', input: {} },
        { type: 'tool_use', id: 'c', name: 'local', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'web_fetch_tool_result', tool_use_id: 'old', content: { type: 'web_fetch_result' } },
        { type: 'text', text: 'Historical result' }] }, { role: 'user', content: 'New question' },
    ]
    const result = qualify({ ...payload(), messages }, headers)!
    expect(result).not.toBeNull(); expect(JSON.parse(result.body).messages).toEqual(messages)
  })
  it.each(['wrong-family', 'before-call', 'duplicate-id', 'inside-user-data'])('does not close a server action from %s', variant => {
    const call = { type: 'server_tool_use', id: 'old', name: 'code_execution', input: {} }
    const result = { type: 'code_execution_tool_result', tool_use_id: 'old', content: {} }
    const messages = variant === 'inside-user-data'
      ? [{ role: 'assistant', content: [call] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c', content: [result] }] }]
      : [{ role: 'assistant', content: variant === 'wrong-family' ? [call,
        { type: 'web_search_tool_result', tool_use_id: 'old', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }]
        : variant === 'before-call' ? [result, call] : [call, result, call] }]
    expect(qualify({ ...payload(), messages }, headers)).toBeNull()
  })
  it('refuses a deferred search when this request omits the native definition', () => {
    expect(qualify({ ...payload(), tools: [], messages: [{ role: 'assistant', content: [
      { type: 'server_tool_use', id: 's', name: 'web_search', input: {} },
    ] }] }, headers)).toBeNull()
  })
})
