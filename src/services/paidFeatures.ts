import type { BillingContext } from './billingContext'

// A verified, account-bound plan receipt. Never trust localStorage, a trial
// counter, a BYOK header or a wallet balance to fund background server work.
let receipt: { context: BillingContext; paid: boolean } | null = null
const listeners = new Set<() => void>()
export function publishPaidFeatures(context: BillingContext, plan: string): void {
  if (!context.isCurrent()) return
  receipt = { context, paid: ['subscription', 'pro', 'vip'].includes(plan) }
  for (const listener of listeners) listener()
}
export function clearPaidFeatures(): void {
  receipt = null
  for (const listener of listeners) listener()
}
export function hasPaidServerFeatures(): boolean {
  try { return !!receipt?.paid && receipt.context.isCurrent() } catch { return false }
}
export function subscribePaidFeatures(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
