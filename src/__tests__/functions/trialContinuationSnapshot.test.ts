import { afterEach, describe, expect, it, vi } from 'vitest'
import { readTrialCounterRemaining } from '../../../functions/api/_lib/trialAdmission'
import type { Env } from '../../../functions/env'

function fixture(read: () => Promise<unknown>) {
  const first = vi.fn(read), bind = vi.fn(() => ({ first })), prepare = vi.fn(() => ({ bind }))
  const batch = async () => { const row = await first() as { used?: unknown } | null
    const valid = row === null || (typeof row.used === 'number' && Number.isInteger(row.used) && row.used >= 0 && row.used <= 30)
    return [...Array.from({ length: 4 }, () => ({ success: true, results: [] })),
      { success: true, results: [{ total: valid ? row?.used ?? 0 : 0, invalid: valid ? 0 : 1 }] }]
  }
  return { env: { DB: { prepare, batch } } as unknown as Env, prepare, bind, first }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('continuation snapshot preserves the public trial identity contract', () => {
  it.each(['trial_usage', 'email_trial_usage'] as const)('reads the shared restriction without changing identity in %s', async table => {
    const f = fixture(async () => ({ used: 30 }))
    expect(await readTrialCounterRemaining(f.env, 'exact.name+tag@gmail.com', table)).toBe(0)
    expect(f.prepare).toHaveBeenCalledTimes(5)
    expect(f.bind).toHaveBeenCalledExactlyOnceWith('exact.name+tag@gmail.com', 'exactname@gmail.com')
    expect(f.first).toHaveBeenCalledOnce()
  })
  it.each([{ row: null, remaining: 30 }, { row: { used: 0 }, remaining: 30 }, { row: { used: 7 }, remaining: 23 },
    { row: { used: -1 }, remaining: null }, { row: { used: 31 }, remaining: null }, { row: { used: 1.5 }, remaining: null },
    { row: { used: '30' }, remaining: null }, { row: {}, remaining: null }])('does not infer exhaustion from $row', async ({ row, remaining }) => {
    expect(await readTrialCounterRemaining(fixture(async () => row).env, 'a@example.test', 'trial_usage')).toBe(remaining)
  })
  it('keeps missing storage and synchronous/asynchronous read failure unknown', async () => {
    expect(await readTrialCounterRemaining({} as Env, 'a@example.test', 'trial_usage')).toBeNull()
    const f = fixture(async () => { throw new Error('synthetic D1 failure') })
    expect(await readTrialCounterRemaining(f.env, 'a@example.test', 'trial_usage')).toBeNull()
    f.prepare.mockImplementation(() => { throw new Error('synthetic prepare failure') })
    expect(await readTrialCounterRemaining(f.env, 'a@example.test', 'trial_usage')).toBeNull()
  })
  it.each(['resolve', 'reject'])('stays unknown after a late D1 %s without a write or replay', async outcome => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void, reject!: (error: Error) => void
    const pending = new Promise((yes, no) => { resolve = yes; reject = no })
    const f = fixture(() => pending)
    const snapshot = readTrialCounterRemaining(f.env, 'a@example.test', 'trial_usage')
    await vi.advanceTimersByTimeAsync(251)
    expect(await snapshot).toBeNull()
    if (outcome === 'resolve') { resolve({ used: 30 }); await pending }
    else { reject(new Error('synthetic late failure')); await expect(pending).rejects.toThrow('synthetic late failure') }
    await Promise.resolve()
    expect(await snapshot).toBeNull(); expect(f.first).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })
})
