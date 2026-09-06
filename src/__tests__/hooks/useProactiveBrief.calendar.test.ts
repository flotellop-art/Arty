import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProactiveBrief } from '../../hooks/useProactiveBrief'
import { resetCalendarFixture, relinkCalendarGoogle, syntheticEvent } from '../helpers/calendarFixture'
import { streamMessage } from '../../services/anthropicClient'
import { addTask } from '../../services/taskService'
import type { BriefItem } from '../../services/proactiveBriefActions'
vi.mock('../../services/apiBase', () => ({ apiUrl: (path: string) => path }))
vi.mock('../../services/anthropicClient', () => ({ streamMessage: vi.fn(() => new AbortController()) }))
vi.mock('../../services/proactiveBriefSettings', () => ({ isProactiveBriefEnabled: () => true, isBriefDue: () => true, markBriefRun: vi.fn(), shouldScheduleNudge: () => false, markNudgeScheduled: vi.fn(), getBriefPrefs: () => ({ length: 'normal' }) }))
vi.mock('../../services/notificationService', () => ({ areNotificationsEnabled: () => false }))
vi.mock('../../services/taskService', () => ({ getTasks: () => [], addTask: vi.fn() }))
vi.mock('../../services/memoryService', () => ({ readAllMemory: async () => [], formatMemoryForPrompt: () => '' }))
beforeEach(async () => { await resetCalendarFixture(); vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function trigger() {
  // Real timers/IDB: foreground is the same trigger as the delayed mount.
  const hook = renderHook(() => useProactiveBrief({ isGoogleConnected: true, onSend: vi.fn() }))
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  return hook
}
describe('Proactive brief Calendar ownership', () => {
  it('unavailable is not a calm/empty agenda and does not call an AI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    const hook = await trigger()
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.brief).toEqual({ text: expect.stringContaining('Agenda indisponible') })
    expect(streamMessage).not.toHaveBeenCalled()
  })
  it('only a validated empty list can produce the calm brief without AI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ events: [] })))
    const hook = await trigger()
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.brief).not.toEqual({ text: expect.stringContaining('Agenda indisponible') })
    expect(hook.result.current.brief).not.toBeNull(); expect(streamMessage).not.toHaveBeenCalled()
  })
  it('binds read tools and post-auth AI boundaries to the original grant, then discards stale output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ events: [syntheticEvent] })))
    const hook = await trigger()
    await act(async () => { await vi.waitFor(() => expect(streamMessage).toHaveBeenCalledOnce()) })
    const call = vi.mocked(streamMessage).mock.calls[0]!, options = call[4]!
    expect(options.tools?.map(t => t.name)).not.toContain('create_calendar_event')
    await options.beforeDocumentRequest!(); options.assertRequestCurrent!()
    expect((await options.onToolCall!('list_calendar', {})).result).toContain('opaque-google-id')
    await act(async () => relinkCalendarGoogle('b'))
    expect(options.assertRequestCurrent).toThrow()
    await expect(options.beforeDocumentRequest!()).rejects.toThrow()
    await act(async () => { call[1]('Old A private content'); call[2](); await Promise.resolve() })
    expect(JSON.stringify(hook.result.current.brief)).not.toContain('Old A private content')
  })
  it('allows Hide/Restore but rejects a retained item after relink or unmount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ events: [syntheticEvent] })))
    const hook = await trigger()
    await act(async () => { await vi.waitFor(() => expect(streamMessage).toHaveBeenCalledOnce()) })
    const call = vi.mocked(streamMessage).mock.calls[0]!
    await act(async () => {
      await call[4]!.onToolCall!('present_brief', { items: [{ title: 'Synthetic task', source: 'agenda', actions: [{ type: 'reminder' }] }] })
      call[2]()
    })
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    const item = (hook.result.current.brief as { items: BriefItem[] }).items[0]!
    act(() => { hook.result.current.dismiss(); hook.result.current.restore() })
    expect(hook.result.current.runAction({ type: 'reminder' }, item)).toBe('task')
    expect(addTask).toHaveBeenCalledOnce()
    const retainedAction = hook.result.current.runAction
    await act(async () => relinkCalendarGoogle('b'))
    expect(retainedAction({ type: 'reminder' }, item)).toBeNull()
    await act(async () => relinkCalendarGoogle('a'))
    expect(retainedAction({ type: 'reminder' }, item)).toBeNull()
    hook.unmount()
    expect(retainedAction({ type: 'reminder' }, item)).toBeNull()
    expect(addTask).toHaveBeenCalledOnce()
  })
})
