import { getTrialRemaining } from './trialClient'

/** UI hint only. The proxy authenticates the owner and enforces the real counter. */
export function hasActiveLunaTrial(plan: string | null, remaining: number | null): boolean {
  return (plan === 'free' || plan === 'trial') && remaining !== null
    && Number.isInteger(remaining) && remaining > 0 && remaining <= 30
}

export function hasCachedLunaTrial(): boolean {
  try { return hasActiveLunaTrial(localStorage.getItem('arty-plan-cache'), getTrialRemaining()) }
  catch { return false }
}
