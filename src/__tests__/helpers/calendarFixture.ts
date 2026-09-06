import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { vi } from 'vitest'
import i18n from '../../i18n'
import * as google from '../../services/googleAuth'
import { initCrypto } from '../../services/crypto'
import { setActiveSession } from '../../services/userSession'
export { google }
export const syntheticEvent = { id: 'opaque-google-id', title: 'Synthetic appointment', start: '2026-08-13T09:00:00+02:00', end: '2026-08-13T10:00:00+02:00', location: '', description: '' }
export async function installCalendarAccount(name = 'a', expired = false) {
  setActiveSession({ userId: name, authMethod: 'google', email: `${name}@example.invalid`, displayName: name, createdAt: 1 })
  await initCrypto('synthetic-calendar-key')
  await relinkCalendarGoogle(name, expired)
}
/** Change only the linked Google grant; the Arty/BYOK owner stays unchanged. */
export async function relinkCalendarGoogle(name: string, expired = false) {
  await google.storeUser({ email: `${name}@example.invalid`, name, picture: '' })
  await google.storeMailboxFreeGrant({ access_token: `synthetic-${name}`, refresh_token: `synthetic-refresh-${name}`, expires_at: Date.now() + (expired ? -1000 : 3600_000) }, undefined, { verifiedEmail: `${name}@example.invalid` })
}
export async function resetCalendarFixture() {
  await i18n.changeLanguage('fr')
  vi.restoreAllMocks(); localStorage.clear(); google.resetGoogleMemCache()
  globalThis.indexedDB = new IDBFactory()
  await installCalendarAccount()
}
export const draft = { title: 'Synthetic appointment', start: '2026-08-13T09:00', end: '2026-08-13T10:00' }
export const created = () => Response.json({ id: syntheticEvent.id, title: draft.title, start: syntheticEvent.start })
