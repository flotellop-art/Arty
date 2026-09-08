import { consumeSharedTrialCounter, readSharedTrialRemaining, trialBenefitKey } from './trialBenefit'
import type { Env } from '../../env'
import type { QuotaWaitUntil } from './atomicQuota'

export type TrialAdmission = { status: 'consumed'; count: number } | { status: 'cap_reached' } | { status: 'unavailable' }
const DEADLINE_MS = 250

/** Read-only snapshot for a restrictive continuation, never an admission.
 * Sum the restriction group without changing either channel identity. A failed, corrupt
 * or late read is unknown, not proof of exhaustion or permission to charge. */
export async function readTrialCounterRemaining(env: Env, email: string, table: 'trial_usage' | 'email_trial_usage'): Promise<number | null> {
  if (!env.DB || (table !== 'trial_usage' && table !== 'email_trial_usage')) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const pending = readSharedTrialRemaining(env, email)
    return await Promise.race([pending, new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), DEADLINE_MS)
    })])
  } catch { return null }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

/** Only the two fixed trial tables are accepted. SQL data is always bound.
 * No write replay, no repair of malformed counters, no grant on uncertainty.
 * The deadline covers the increment/readback, not all authentication/setup.
 */
export async function consumeTrialCounter(env: Env, email: string, table: 'trial_usage' | 'email_trial_usage',
  refund: () => Promise<void>, waitUntil?: QuotaWaitUntil): Promise<TrialAdmission> {
  if (!env.DB) return { status: 'unavailable' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const key = trialBenefitKey(email)
  const pending: Promise<TrialAdmission> = key ? consumeSharedTrialCounter(env, email, table, key)
    : Promise.resolve({ status: 'unavailable' })
  try {
    const outcome = await Promise.race([pending, new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), DEADLINE_MS)
    })])
    if (outcome !== 'timeout') return outcome
    // Without a background lifetime, wait for the actual result before
    // admission. With waitUntil, refuse now and own the sole late compensation.
    if (!waitUntil) return await pending
    const compensation = pending.then(async late => {
      if (late.status === 'consumed') await refund()
    })
    try { waitUntil(compensation) } catch {
      try { await compensation } catch {
        // An ambiguous refund must not be replayed or change the refusal.
        console.error('[trial] late compensation unavailable')
      }
    }
    return { status: 'unavailable' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
