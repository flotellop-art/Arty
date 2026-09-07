// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../../functions/env'
import { checkAllowedVerifiedUser } from '../../../functions/api/_lib/checkAllowedUser'
import { consumeEmailTrialMessage, resolveProxyIdentityDetailed } from '../../../functions/api/_lib/emailTrial'
import { consumeFreeDailyQuota, consumeOwnerApiQuota, consumeTtsFreeQuota } from '../../../functions/api/_lib/freeQuota'

afterEach(() => vi.restoreAllMocks())

function brokenDb(): D1Database {
  const statement = { bind: () => statement, first: async () => { throw new Error('synthetic SQL outage') },
    run: async () => { throw new Error('synthetic SQL outage') } }
  return { prepare: () => statement } as unknown as D1Database
}

describe('unconfirmed free admission is never an authorization', () => {
  it.each(['absent', 'error'])('does not downgrade unknown Google rights to free: %s', async state => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const env = { DB: state === 'error' ? brokenDb() : undefined } as unknown as Env
    const result = await checkAllowedVerifiedUser('owner@example.com', env)
    expect(result).toEqual({ error: 'admission_unavailable' })
  })

  it.each(['absent', 'error'])('does not allow an unconfirmed OTP trial quota: %s', async state => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const env = { DB: state === 'error' ? brokenDb() : undefined } as unknown as Env
    expect(await consumeEmailTrialMessage(env, 'owner@example.com')).toEqual({ error: 'admission_unavailable' })
  })

  it.each(['absent', 'error'])('preserves OTP session outage as unavailable, not sign-out: %s', async state => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const env = { DB: state === 'error' ? brokenDb() : undefined } as unknown as Env
    const request = new Request('https://tryarty.com/api/ai/proxy', { headers: { 'x-arty-trial-token': 'synthetic-session' } })
    expect(await resolveProxyIdentityDetailed(request, env)).toEqual({ status: 'unavailable' })
  })

  it.each([
    ['daily text', (env: Env) => consumeFreeDailyQuota(env, 'owner@example.com', 'claude-haiku-4-5-20251001')],
    ['voice', (env: Env) => consumeTtsFreeQuota(env, 'owner@example.com')],
    ['owner tools', (env: Env) => consumeOwnerApiQuota(env, 'owner@example.com', 'web-search')],
  ] as const)('refuses %s when its counter is missing or unavailable', async (_name, consume) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const DB of [undefined, brokenDb()]) {
      const result = await consume({ DB } as unknown as Env)
      expect(result).toMatchObject({ allowed: false, unavailable: true })
    }
  })
})
