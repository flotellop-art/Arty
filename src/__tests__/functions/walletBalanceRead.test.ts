// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { ensureWalletTables, getWalletBalance, readWalletBalance } from '../../../functions/api/_lib/wallet'
import { onRequestGet } from '../../../functions/api/wallet/balance'

vi.mock('../../../functions/api/_lib/checkAllowedUser', () => ({ verifyGoogleUserStrict: async () => 'wallet-reader@example.test' }))

const EMAIL = 'wallet-reader@example.test'
const row = { balance_micro: 994_112, reserved_micro: 0, reversal_pending: 0 }

async function fixture(first: () => Promise<typeof row | null>) {
  const statement = { first: vi.fn(first), bind: vi.fn() }
  statement.bind.mockReturnValue(statement)
  const db = { prepare: vi.fn(() => statement), batch: vi.fn(async () => []) }
  const env = { DB: db } as unknown as Env
  await ensureWalletTables(env)
  vi.clearAllMocks()
  return { env, db, statement }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('wallet hot-path balance reader (not an accounting oracle)', () => {
  it.each([{ reversal_pending: undefined }, { reversal_pending: 2 }, { balance_micro: -1 },
    { balance_micro: '994112' }, { reserved_micro: NaN }])('rejects malformed accounting reads without inventing a zero (%j)', async patch => {
    const { env } = await fixture(async () => ({ ...row, ...patch }) as typeof row)
    expect(await readWalletBalance(env, EMAIL)).toEqual({ status: 'unavailable' })
  })

  it.each(['timeout', 'sql-error'])('returns a non-cacheable API 503 with no financial amounts on %s', async failure => {
    let release!: (value: typeof row) => void
    const pending = new Promise<typeof row>(resolve => { release = resolve })
    const { env, db } = await fixture(() => failure === 'timeout' ? pending : Promise.reject(new Error('synthetic SQL error')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    const result = onRequestGet({ env, request: new Request('https://tryarty.com/api/wallet/balance') } as never)
    try {
      await vi.advanceTimersByTimeAsync(250)
      const response = await result
      expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ error: 'wallet_temporarily_unavailable' })
      expect(db.batch).not.toHaveBeenCalled()
    } finally { release(row); await pending }
  })

  it('returns exact available balance for a completed read', async () => {
    const { env, db, statement } = await fixture(async () => ({ ...row, reserved_micro: 112 }))
    expect(await getWalletBalance(env, EMAIL)).toEqual({
      balanceMicro: 994_112, reservedMicro: 112, availableMicro: 994_000, reversalPending: false,
    })
    expect(statement.bind).toHaveBeenCalledWith(EMAIL)
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('returns null for an absent wallet', async () => {
    const { env } = await fixture(async () => null)
    expect(await getWalletBalance(env, EMAIL)).toBeNull()
  })

  it('returns null on D1 read error without trying to write', async () => {
    const error = new Error('synthetic read failure')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env, db } = await fixture(async () => { throw error })
    expect(await getWalletBalance(env, EMAIL)).toBeNull()
    expect(log).toHaveBeenCalledWith(
      '[wallet] getWalletBalance erreur — traité comme pas de wallet', error,
    )
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('returns null at 250 ms even when a valid balance arrives later', async () => {
    let release!: (value: typeof row) => void
    const heldRead = new Promise<typeof row>((resolve) => { release = resolve })
    const { env, db } = await fixture(() => heldRead)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    let finished = false
    const reading = getWalletBalance(env, EMAIL).then((value) => {
      finished = true
      return value
    })
    try {
      await vi.advanceTimersByTimeAsync(249)
      expect(finished).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await reading).toBeNull()
      expect(log).toHaveBeenCalledExactlyOnceWith(
        '[wallet] getWalletBalance D1 timeout — traité comme pas de wallet',
      )
    } finally {
      // Drain the held query even if an assertion fails; never leave it pending.
      release(row)
      await heldRead
    }
    expect(await reading).toBeNull()
    expect(await getWalletBalance(env, EMAIL)).toEqual({
      balanceMicro: 994_112, reservedMicro: 0, availableMicro: 994_112, reversalPending: false,
    })
    expect(db.batch).not.toHaveBeenCalled()
  })
})
