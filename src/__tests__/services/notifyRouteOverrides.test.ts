import { describe, expect, it, vi } from 'vitest'
import { notifyRouteOverrides } from '../../services/router/notifyRouteOverrides'

describe('notifyRouteOverrides', () => {
  it('ne notifie jamais une décision Auto normale', () => {
    const notify = vi.fn()
    notifyRouteOverrides([], notify)
    expect(notify).not.toHaveBeenCalled()
  })

  it('notifie une contradiction de choix manuel avec un libellé lisible', () => {
    const notify = vi.fn()
    notifyRouteOverrides([
      {
        requested: 'openai',
        applied: 'claude',
        reason: { code: 'private_data' },
      },
    ], notify)

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('ChatGPT'), 'info')
  })
})
