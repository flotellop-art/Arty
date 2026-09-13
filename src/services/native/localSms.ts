import { Capacitor, registerPlugin } from '@capacitor/core'
import { getActiveSession, getActiveSessionEpoch } from '../userSession'
import { onLocalDataInvalidated } from '../localDataInvalidation'
import { captureOwnerErasureGuard } from '../projects/localErasureGuard'
import { documentWorkspaceSignal } from '../workspaceWriter/runtime'

// Intentionally metadata/control ONLY. SMS never enter the WebView, AI tools,
// conversation storage, exports or sync. Consent is native process memory.
export interface LocalSmsStatus { decision: 'unknown' | 'declined' | 'allowed'; permission: boolean }
interface Ticket { token: string }
interface LocalSmsPlugin {
  startSession(ticket: Ticket): Promise<LocalSmsStatus>
  endSession(ticket: Ticket): Promise<void>
  getStatus(ticket: Ticket): Promise<LocalSmsStatus>
  requestAccess(ticket: Ticket): Promise<LocalSmsStatus>
  revokeAccess(ticket: Ticket): Promise<LocalSmsStatus>
  openInbox(ticket: Ticket): Promise<void>
}
const plugin = registerPlugin<LocalSmsPlugin>('LocalSms')
type Session = Ticket & { owner: string; epoch: number; guard: () => void; ready: Promise<unknown> }
let active: Session | null = null
let transition: Promise<unknown> = Promise.resolve()
let prompt: { session: Session; promise: Promise<LocalSmsStatus> } | null = null
const listeners = new Set<() => void>()
function changed() { for (const listener of listeners) listener() }
export function onLocalSmsChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function isLocalSmsAvailable() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('LocalSms')
}
function assertCurrent(session: Session) {
  session.guard()
  if (active !== session || documentWorkspaceSignal.aborted || getActiveSession()?.userId !== session.owner ||
      getActiveSessionEpoch() !== session.epoch) throw new Error('sms_cancelled')
}
function retire() {
  const old = active; active = null; prompt = null
  if (old) transition = transition.catch(() => {}).then(() => plugin.endSession({ token: old.token })).catch(() => {})
  changed()
}
onLocalDataInvalidated(() => {
  if (active) { try { assertCurrent(active) } catch { retire() } }
})
documentWorkspaceSignal.addEventListener('abort', retire, { once: true })

async function sessionTicket(): Promise<Session> {
  if (!isLocalSmsAvailable() || documentWorkspaceSignal.aborted) throw new Error('sms_unavailable')
  const user = getActiveSession()
  if (!user || user.authMethod === 'demo') throw new Error('sms_unavailable')
  if (active) { try { assertCurrent(active) } catch { retire() } }
  if (!active) {
    const session: Session = {
      owner: user.userId, epoch: getActiveSessionEpoch(), token: crypto.randomUUID(),
      guard: captureOwnerErasureGuard(user.userId), ready: Promise.resolve(),
    }
    active = session
    session.ready = transition.catch(() => {}).then(() => {
      assertCurrent(session)
      return plugin.startSession({ token: session.token })
    })
    transition = session.ready
  }
  const session = active
  await session.ready
  assertCurrent(session)
  return session
}
async function invoke<T>(method: (ticket: Ticket) => Promise<T>): Promise<T> {
  const session = await sessionTicket()
  return callCurrent(session, method)
}
async function callCurrent<T>(session: Session, method: (ticket: Ticket) => Promise<T>): Promise<T> {
  assertCurrent(session)
  const result = await method({ token: session.token })
  assertCurrent(session)
  return result
}
export function getLocalSmsStatus() { return invoke(ticket => plugin.getStatus(ticket)) }
export async function requestLocalSmsAccess() {
  const session = await sessionTicket()
  return requestForSession(session)
}
function requestForSession(session: Session) {
  assertCurrent(session)
  if (prompt?.session === session) return prompt.promise
  const promise = callCurrent(session, ticket => plugin.requestAccess(ticket)).finally(() => {
    if (prompt?.session === session) prompt = null
    changed()
  })
  prompt = { session, promise }
  return promise
}
export async function offerLocalSmsOnStartup() {
  const session = await sessionTicket()
  const status = await plugin.getStatus({ token: session.token })
  assertCurrent(session)
  if (status.decision === 'unknown') return requestForSession(session)
  return status
}
export async function revokeLocalSmsAccess() {
  const result = await invoke(ticket => plugin.revokeAccess(ticket))
  changed()
  return result
}
export function openLocalSmsInbox() { return invoke(ticket => plugin.openInbox(ticket)) }
