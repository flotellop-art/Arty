import { Capacitor } from '@capacitor/core'
import { captureLocalReadScope } from './projects/store'
import { captureActiveKeysInstallation } from './activeApiKey'
import { hasPersonalKey } from './providerLock'
import { captureGoogleAuthIntent, getGoogleConfigurationStatus } from './googleAuth'
import { captureCalendarContext } from './calendarClient'
import { getMailInventoryStatus } from './mailAccounts'
import { getActiveSession } from './userSession'
import type { TransportProvider } from './modelCatalog'

export type ConnectionState = 'configured' | 'not-configured' | 'loading' | 'unknown' | 'unavailable' | 'reconnect' | 'not-supported'
export interface ConnectionsSnapshot {
  platform: 'web' | 'android' | 'ios' | 'other'; demo: boolean;
  session: 'google' | 'email' | 'apikey' | 'demo';
  google: ConnectionState; keys: { provider: TransportProvider; state: ConnectionState }[];
  mail: ConnectionState; mailCount: number
}
export const CONNECTION_PROVIDERS: TransportProvider[] = ['anthropic', 'openai', 'gemini', 'mistral']
export function connectionPlatform(): ConnectionsSnapshot['platform'] {
  if (!Capacitor.isNativePlatform()) return 'web'
  const platform = Capacitor.getPlatform()
  return platform === 'android' || platform === 'ios' ? platform : 'other'
}
const pluginPresent = (name: string) => { try { return Capacitor.isPluginAvailable(name) } catch { return false } }

/** One readonly, owner-bound receipt. Its guards never enter the rendered DTO. */
export async function readConnectionsSnapshot(signal: AbortSignal) {
  const scope = captureLocalReadScope(signal), session = getActiveSession()
  const googleCurrent = captureGoogleAuthIntent(), keys = captureActiveKeysInstallation(), mail = getMailInventoryStatus()
  const platform = connectionPlatform()
  const googleSupported = platform === 'web' || (platform === 'android' && pluginPresent('GoogleSignInNative'))
  const mailSupported = platform === 'android' && pluginPresent('MailImap')
  const google = googleSupported ? getGoogleConfigurationStatus() : 'not-supported'
  const calendar = google === 'configured' ? captureCalendarContext(signal) : null
  const snapshot: ConnectionsSnapshot = {
    platform, demo: session?.authMethod === 'demo', session: session?.authMethod ?? 'demo',
    google: google === 'configured' && !calendar ? 'unavailable' : google,
    keys: CONNECTION_PROVIDERS.map(provider => ({ provider, state: keys.ready ? hasPersonalKey(provider) ? 'configured' : 'not-configured' : 'unknown' })),
    mail: !mailSupported ? 'not-supported' : mail.status === 'ready' ? mail.count ? 'configured' : 'not-configured'
      : mail.status === 'failed' ? 'unavailable' : mail.status,
    mailCount: mailSupported && mail.status === 'ready' ? mail.count : 0,
  }
  const assertCurrent = () => {
    scope.assertCurrent()
    if (!googleCurrent() || (keys.ready && !keys.isCurrent()) || getMailInventoryStatus().generation !== mail.generation) throw new Error('Connections view superseded')
    calendar?.assertCurrent()
  }
  assertCurrent(); await scope.validateReadOnly(); assertCurrent()
  return { snapshot, assertCurrent }
}
