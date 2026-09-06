import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import { streamMessage } from '../../services/anthropicClient'
import { captureCalendarContext } from '../../services/calendarClient'
import { createCalendarHandlers } from '../../services/tools/calendarTools'
import { google, resetCalendarFixture, syntheticEvent } from '../helpers/calendarFixture'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/activeApiKey', () => ({ getAnthropicKey: () => 'synthetic-key' }))
beforeEach(async () => { await resetCalendarFixture(); await google.bootstrapGoogleStorage() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function sse(tool: boolean) {
  const events = [
    { type: 'message_start', message: { model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: 'tool-1', name: 'list_calendar', input: {} } : { type: 'text', text: '' } },
    ...(tool ? [] : [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Finished' } }]),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
describe('Actual Claude SSE loop → actual Calendar handler → synthetic HTTP', () => {
  it.each([false, true])('validates the durable fence before continuing with Calendar data (changed=%s)', async changed => {
    const scope = captureCalendarContext()!, handlers = createCalendarHandlers(), bodies: object[] = []
    let aiRequests = 0, calendarRequests = 0, used = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/calendar/action') { calendarRequests++; return Response.json({ events: [syntheticEvent] }) }
      expect(url).toBe('/api/ai/proxy'); bodies.push(JSON.parse(init.body as string))
      return sse(++aiRequests === 1)
    }))
    const result = await new Promise<{ text: string; error?: Error }>((resolve, reject) => {
      let text = ''
      const timeout = setTimeout(() => reject(new Error('Synthetic loop did not finish')), 3000)
      const finish = (error?: Error) => { clearTimeout(timeout); resolve({ text, error }) }
      streamMessage([{ role: 'user', content: 'Mon agenda ?' }], token => { text += token }, () => finish(), finish, {
        model: 'claude-haiku-4-5-20251001',
        assertRequestCurrent: () => { if (used) scope.assertCurrent() },
        beforeDocumentRequest: async () => { if (used) await scope.validateReadOnly() },
        onToolCall: async (name, input) => {
          expect(name).toBe('list_calendar'); used = true
          const result = await handlers.list_calendar!(input, { calendar: { scope } })
          expect(result.result).toContain('opaque-google-id')
          if (changed) {
            const db = await openDB('arty-projects', 1, { upgrade(db) { db.createObjectStore('meta') } })
            await db.put('meta', 'changed-durably', 'erasure-fence'); db.close()
          }
          return result
        },
      })
    })
    expect(calendarRequests).toBe(1)
    if (changed) { expect(result.error).toBeInstanceOf(Error); expect(aiRequests).toBe(1) }
    else { expect(result.error).toBeUndefined(); expect(result.text).toBe('Finished'); expect(aiRequests).toBe(2); expect(JSON.stringify(bodies[1])).toContain('opaque-google-id') }
  })
})
