import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppSetup } from '../../hooks/useAppSetup'
import { google, installCalendarAccount, relinkCalendarGoogle, resetCalendarFixture } from '../helpers/calendarFixture'
import { deferred } from '../helpers/workspaceLocks'
const stubs = vi.hoisted(() => ({ executor: vi.fn(), toast: vi.fn(), navigate: vi.fn(), google: { isConnected: false, user: null }, drive: {}, computer: {}, memory: { loadMemory: vi.fn(), getPromptContext: vi.fn(() => '') } }))
vi.mock('../../services/toolExecutor', () => ({ createToolExecutor: () => stubs.executor }))
vi.mock('../../services/toast', () => ({ toast: stubs.toast }))
vi.mock('react-router-dom', () => ({ useNavigate: () => stubs.navigate }))
vi.mock('../../hooks/useGoogleAuth', () => ({ useGoogleAuth: () => stubs.google }))
vi.mock('../../hooks/useDrive', () => ({ useDrive: () => stubs.drive }))
vi.mock('../../hooks/useComputer', () => ({ useComputer: () => stubs.computer }))
vi.mock('../../hooks/useMemory', () => ({ useMemory: () => stubs.memory }))
vi.mock('../../services/mailAccounts', () => ({ hasConnectedMailAccounts: () => false, refreshMailAccounts: vi.fn(), getCachedMailAccounts: () => [] }))
beforeEach(async () => { await resetCalendarFixture(); vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const setup = () => renderHook(() => useAppSetup({ activeId: 'synthetic-conversation', sendMessage: vi.fn(), setSystemPrompt: vi.fn(), setToolHandler: vi.fn() }))

describe('report result consumer — original Calendar scope', () => {
  it('publishes the confirmed result for a healthy scope', async () => {
    stubs.executor.mockResolvedValue({ result: 'Synthetic confirmed result' })
    const hook = setup()
    await act(async () => hook.result.current.handleAction('create_event', {}))
    expect(stubs.toast).toHaveBeenCalledWith('Synthetic confirmed result', 'info')
    expect(stubs.executor.mock.calls[0][2].calendar.scope.account).toBe('a@example.invalid')
  })
  it.each(['same', 'other', 'aba', 'owner', 'unmount'] as const)('suppresses the captured private result after %s', async change => {
    const result = deferred<{ result: string }>(); stubs.executor.mockReturnValue(result.promise)
    const hook = setup(), action = hook.result.current.handleAction
    const pending = action('create_event', {})
    if (change === 'unmount') hook.unmount()
    else if (change === 'owner') await act(async () => installCalendarAccount('b'))
    else await act(async () => { await relinkCalendarGoogle(change === 'same' ? 'a' : 'b'); if (change === 'aba') await relinkCalendarGoogle('a') })
    await act(async () => { result.resolve({ result: 'PRIVATE A RESULT' }); await pending })
    expect(stubs.toast.mock.calls.every(call => !String(call[0]).includes('PRIVATE'))).toBe(true)
    if (change === 'unmount') { expect(stubs.toast).not.toHaveBeenCalled(); await action('create_event', {}); expect(stubs.executor).toHaveBeenCalledOnce() }
    else expect(stubs.toast).toHaveBeenCalledWith(expect.stringMatching(/incertaine/), 'error')
  })
  it('shows a generic unavailable notice without calling the executor when disconnected', async () => {
    google.resetGoogleMemCache()
    const hook = setup()
    await act(async () => hook.result.current.handleAction('create_event', {}))
    expect(stubs.executor).not.toHaveBeenCalled()
    expect(stubs.toast).toHaveBeenCalledWith(expect.stringMatching(/indisponible/i), 'error')
  })
})
