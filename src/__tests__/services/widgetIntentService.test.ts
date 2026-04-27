import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @capacitor/core BEFORE importing the service so registerPlugin returns
// the controllable stub we read from in the assertions. vi.mock() is hoisted
// above imports — vi.hoisted() lets us reference variables from inside it.
const { mockGetPendingAction, mockAddListener } = vi.hoisted(() => ({
  mockGetPendingAction: vi.fn(),
  mockAddListener: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    getPendingAction: mockGetPendingAction,
    addListener: mockAddListener,
  }),
}))

import {
  addWidgetActionListener,
  getPendingWidgetAction,
  type WidgetActionPayload,
} from '../../services/widgetIntentService'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('widgetIntentService — getPendingWidgetAction', () => {
  it('returns null when the plugin has nothing pending', async () => {
    mockGetPendingAction.mockResolvedValue({ source: null, action: null })
    const res = await getPendingWidgetAction()
    expect(res).toBeNull()
  })

  it('returns the action payload when the plugin emits one', async () => {
    mockGetPendingAction.mockResolvedValue({ source: 'tap_zone', action: 'open_chat' })
    const res = await getPendingWidgetAction()
    expect(res).toEqual({ source: 'tap_zone', action: 'open_chat' })
  })

  it('returns null when the plugin call rejects', async () => {
    mockGetPendingAction.mockRejectedValue(new Error('plugin missing'))
    const res = await getPendingWidgetAction()
    expect(res).toBeNull()
  })
})

describe('widgetIntentService — addWidgetActionListener', () => {
  it('registers the listener and forwards non-empty payloads only', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    let captured: ((p: WidgetActionPayload) => void) | undefined
    mockAddListener.mockImplementation(async (_evt: string, fn: (p: WidgetActionPayload) => void) => {
      captured = fn
      return { remove }
    })

    const handler = vi.fn()
    const cleanup = await addWidgetActionListener(handler)

    expect(mockAddListener).toHaveBeenCalledWith('widgetAction', expect.any(Function))
    captured?.({ source: null, action: null })
    expect(handler).not.toHaveBeenCalled()
    captured?.({ source: 'tap_zone', action: 'open_chat' })
    expect(handler).toHaveBeenCalledWith({ source: 'tap_zone', action: 'open_chat' })

    cleanup()
    expect(remove).toHaveBeenCalled()
  })

  it('returns a no-op cleanup when the plugin call rejects', async () => {
    mockAddListener.mockRejectedValue(new Error('plugin missing'))
    const cleanup = await addWidgetActionListener(() => {})
    expect(typeof cleanup).toBe('function')
    expect(() => cleanup()).not.toThrow()
  })
})
