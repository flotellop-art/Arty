import i18n from '../i18n'

/** A known financial-state conflict is terminal, unlike a transient 503.
 * Keep parsing bounded to this exact contract; never surface raw JSON. */
export function walletReconciliationError(status: number, body: string): Error | null {
  if (status !== 409) return null
  try {
    if (JSON.parse(body)?.error !== 'wallet_reconciliation_pending') return null
    return Object.assign(new Error(i18n.t('wallet.reversalError')), { name: 'WalletReconciliationError' })
  } catch { return null }
}
