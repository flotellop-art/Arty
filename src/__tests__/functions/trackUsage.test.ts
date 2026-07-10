import { describe, expect, it } from 'vitest'
import {
  createAnthropicParser,
  createGeminiParser,
  createMistralParser,
  createOpenAIParser,
  enforceStreamUsage,
  responseUsageFormat,
  teeForParsing,
} from '../../../functions/api/_lib/trackUsage'

describe('provider usage parsing (JSON and SSE)', () => {
  it('parses Anthropic SSE usage split between message_start and message_delta', () => {
    const parser = createAnthropicParser('sse')
    parser.feed('event: message_start\ndata: {"message":{"usage":{"input_tokens":123,"cache_read_input_tokens":10}}}\n\n')
    parser.feed('event: message_delta\ndata: {"usage":{"output_tokens":45}}\n\n')
    expect(parser.finalize()).toEqual({
      inputTokens: 123,
      outputTokens: 45,
      cacheReadTokens: 10,
      cacheCreationTokens: 0,
      audioSeconds: 0,
      measured: true,
    })
  })

  it('parses a non-streamed Anthropic JSON response', () => {
    const parser = createAnthropicParser('json')
    parser.feed(JSON.stringify({ usage: { input_tokens: 20, output_tokens: 7 } }))
    expect(parser.finalize().measured).toBe(true)
    expect(parser.finalize()).toMatchObject({ inputTokens: 20, outputTokens: 7 })
  })

  it.each([
    ['OpenAI', createOpenAIParser],
    ['Mistral', createMistralParser],
  ] as const)('parses %s usage in JSON and SSE', (_name, factory) => {
    const json = factory('json')
    json.feed(JSON.stringify({ usage: { prompt_tokens: 31, completion_tokens: 12 } }))
    expect(json.finalize()).toMatchObject({ inputTokens: 31, outputTokens: 12, measured: true })

    const sse = factory('sse')
    sse.feed('data: {"choices":[]}\n\n')
    sse.feed('data: {"usage":{"prompt_tokens":44,"completion_tokens":9}}\n\n')
    sse.feed('data: [DONE]\n\n')
    expect(sse.finalize()).toMatchObject({ inputTokens: 44, outputTokens: 9, measured: true })
  })

  it('parses Gemini generateContent JSON and includes thinking tokens', () => {
    const parser = createGeminiParser('json')
    parser.feed(JSON.stringify({
      usageMetadata: {
        promptTokenCount: 1_234,
        candidatesTokenCount: 456,
        thoughtsTokenCount: 200,
        cachedContentTokenCount: 34,
      },
    }))
    expect(parser.finalize()).toMatchObject({
      inputTokens: 1_234,
      outputTokens: 656,
      cacheReadTokens: 34,
      measured: true,
    })
  })

  it('parses Gemini streaming SSE usage', () => {
    const parser = createGeminiParser('sse')
    parser.feed('data: {"candidates":[{}]}\n\n')
    parser.feed('data: {"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":3}}\n\n')
    expect(parser.finalize()).toMatchObject({ inputTokens: 9, outputTokens: 3, measured: true })
  })

  it('marks absent, incomplete and truncated usage as unmeasured', () => {
    const absent = createOpenAIParser('json')
    absent.feed('{"choices":[]}')
    expect(absent.finalize().measured).toBe(false)

    const incomplete = createAnthropicParser('json')
    incomplete.feed('{"usage":{"input_tokens":12}}')
    expect(incomplete.finalize()).toMatchObject({ inputTokens: 12, measured: false })

    const truncated = createGeminiParser('json')
    truncated.feed('{"usageMetadata":{"promptTokenCount":12')
    expect(truncated.finalize().measured).toBe(false)
  })

  it('does not treat the Anthropic message_start output snapshot as final usage', () => {
    const parser = createAnthropicParser('sse')
    parser.feed('data: {"message":{"usage":{"input_tokens":100,"output_tokens":1}}}\n\n')
    expect(parser.finalize()).toMatchObject({ inputTokens: 100, outputTokens: 0, measured: false })
  })

  it('marks usage unmeasured when the parsing branch errors after a usage chunk', async () => {
    const encoder = new TextEncoder()
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"usage":{"prompt_tokens":9,"completion_tokens":3}}\n\n'))
        controller.error(new Error('upstream interrupted'))
      },
    })
    const parser = createOpenAIParser('sse')
    const { parsedUsage } = teeForParsing(upstream, parser.feed, parser.finalize)
    await expect(parsedUsage).resolves.toMatchObject({ measured: false })
  })
})

describe('stream usage enforcement', () => {
  it('forces include_usage while preserving other stream options', () => {
    const body = enforceStreamUsage(JSON.stringify({
      model: 'gpt-5',
      stream: true,
      stream_options: { custom: 'keep', include_usage: false },
    }))
    expect(JSON.parse(body)).toMatchObject({
      stream: true,
      stream_options: { custom: 'keep', include_usage: true },
    })
  })

  it('does not rewrite non-streaming or malformed bodies', () => {
    const json = '{"stream":false}'
    expect(enforceStreamUsage(json)).toBe(json)
    expect(enforceStreamUsage('{bad')).toBe('{bad')
  })

  it('selects parser format from Content-Type', () => {
    expect(responseUsageFormat('application/json; charset=utf-8')).toBe('json')
    expect(responseUsageFormat('text/event-stream')).toBe('sse')
  })
})
