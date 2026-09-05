import { Capacitor } from '@capacitor/core'
import { getMailImapPlugin } from './mailImapRegistration'

export function assertNativeErasureOwner(owner: string) {
  // Native scopeKey uses UTF-8: reject non-injective replacement of lone
  // surrogates, without normalizing valid opaque Unicode identifiers.
  if (!owner.length || owner.length > 128 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(owner)) throw new Error('native_erasure_owner')
}
export async function clearColdMailScope(owner: string, reset?: { resetId: string; previousResetId: string | null }): Promise<void> {
  assertNativeErasureOwner(owner)
  if (!Capacitor.isNativePlatform()) return
  if (Capacitor.getPlatform() !== 'android') throw new Error('native_erasure_unsupported')
  const plugin = getMailImapPlugin<{
    clearAccountsForErasure(options: { scope: string }): Promise<{ protocol: number }>
    clearAccountsForReset(options: { scope: string; resetId: string; previousResetId: string | null }): Promise<{ protocol: number; resetId: string }>
  }>()
  const result = reset ? await plugin.clearAccountsForReset({ scope: owner, ...reset }) : await plugin.clearAccountsForErasure({ scope: owner })
  if (!result || result.protocol !== (reset ? 2 : 1) || (reset && (!('resetId' in result) || result.resetId !== reset.resetId))) throw new Error('native_erasure_unsupported')
  // No legacy fallback, listAccounts probe, credentials or shared-key deletion.
}
export async function reopenColdMailScope(owner: string, resetId: string): Promise<void> {
  assertNativeErasureOwner(owner)
  if (!Capacitor.isNativePlatform()) return
  if (Capacitor.getPlatform() !== 'android') throw new Error('Une mise à jour Android est nécessaire pour recréer cet espace local.')
  const plugin = getMailImapPlugin<{ reopenAccountsAfterReset(options: { scope: string; resetId: string }): Promise<{ protocol: number; resetId: string }> }>()
  const result = await plugin.reopenAccountsAfterReset({ scope: owner, resetId })
  if (!result || result.protocol !== 2 || result.resetId !== resetId) throw new Error('Une mise à jour Android est nécessaire pour recréer cet espace local.')
}
