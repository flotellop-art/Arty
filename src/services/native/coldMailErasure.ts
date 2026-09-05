import { Capacitor } from '@capacitor/core'
import { getMailImapPlugin } from './mailImapRegistration'

export function assertNativeErasureOwner(owner: string) {
  // Native scopeKey uses UTF-8: reject non-injective replacement of lone
  // surrogates, without normalizing valid opaque Unicode identifiers.
  if (!owner.length || owner.length > 128 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(owner)) throw new Error('native_erasure_owner')
}
export async function clearColdMailScope(owner: string): Promise<void> {
  assertNativeErasureOwner(owner)
  if (!Capacitor.isNativePlatform()) return
  if (Capacitor.getPlatform() !== 'android') throw new Error('native_erasure_unsupported')
  const plugin = getMailImapPlugin<{ clearAccountsForErasure(options: { scope: string }): Promise<{ protocol: number }> }>()
  const result = await plugin.clearAccountsForErasure({ scope: owner })
  if (!result || result.protocol !== 1) throw new Error('native_erasure_unsupported')
  // No legacy fallback, listAccounts probe, credentials or shared-key deletion.
}
