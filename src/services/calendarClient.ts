import i18n from '../i18n'
import type { CalendarEvent } from '../types/google'
import { captureGoogleGrant, getStoredTokens, getStoredUser } from './googleAuth'
import { captureLocalReadScope } from './projects/store'
import { calendarMutationPayload, CALENDAR_PROTOCOL, CalendarValidationError, type CalendarMutation } from '../utils/calendarProtocol'
import { apiUrl } from './apiBase'
import { documentWorkspaceSignal } from './workspaceWriter/runtime'

export type CalendarFailure = 'not-sent' | 'rejected-before-dispatch' | 'unknown' | 'already-attempted'
export class CalendarError extends Error {
  constructor(readonly outcome: CalendarFailure, message?: string) {
    super(outcome === 'not-sent' && message ? message : i18n.t(`calendarWorkflow.errors.${outcome}`))
    this.name = 'CalendarError'
  }
}
export const calendarErrorMessage = (error: unknown) => error instanceof CalendarError ? error.message : i18n.t('calendarWorkflow.unavailable')

/** Local authority, never taken from model arguments nor serialized. */
export interface CalendarContext { readonly account: string; assertCurrent(): void; validateReadOnly(): Promise<void> }
type Authority = { grant: NonNullable<ReturnType<typeof captureGoogleGrant>>; scope: ReturnType<typeof captureLocalReadScope>; signal?: AbortSignal; attempted: boolean }
const authorities = new WeakMap<CalendarContext, Authority>()

/** Capture synchronously at form opening, listing start or user-turn start. */
export function captureCalendarContext(signal?: AbortSignal): CalendarContext | null {
  try {
    const grant = captureGoogleGrant()
    if (!grant) return null
    const scope = captureLocalReadScope(signal)
    const verified = getStoredTokens()?.verified_email?.trim().toLowerCase()
    if (!verified || getStoredUser()?.email.trim().toLowerCase() !== verified || !grant.isCurrent()) return null
    const context: CalendarContext = Object.freeze({ account: verified, assertCurrent() {
      try { scope.assertCurrent(); if (!grant.isCurrent()) throw new Error() }
      catch { throw new CalendarError('not-sent') }
    }, async validateReadOnly() { await scope.validateReadOnly(); context.assertCurrent() } })
    authorities.set(context, { grant, scope, signal, attempted: false })
    return context
  } catch { return null }
}
function authority(context: CalendarContext | null): Authority {
  const value = context && authorities.get(context)
  if (!value) throw new CalendarError('not-sent')
  context!.assertCurrent()
  return value
}
/** Cancel only this consumer's wait, never the shared Google refresh. */
function waitLocally<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Calendar wait cancelled'))
    if (signal.aborted) { promise.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
function boundedSignal(signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController(), abort = () => controller.abort()
  const present = signals.filter((signal): signal is AbortSignal => !!signal)
  for (const signal of present) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }) }
  const timer = setTimeout(abort, 25_000)
  return { signal: controller.signal, dispose() { clearTimeout(timer); for (const signal of present) signal.removeEventListener('abort', abort) } }
}
async function request(context: CalendarContext | null, json: string, mutation: boolean, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let dispatched = false
  let dispose = () => {}
  try {
    const auth = authority(context)
    const bounded = boundedSignal([documentWorkspaceSignal, auth.signal, signal]), requestSignal = bounded.signal
    dispose = bounded.dispose
    if (requestSignal.aborted) throw new CalendarError('not-sent')
    const token = await waitLocally(auth.grant.getAccessToken(), requestSignal)
    if (!token) throw new CalendarError('not-sent')
    await waitLocally(auth.scope.validateReadOnly(), requestSignal)
    context!.assertCurrent()
    if (requestSignal.aborted) throw new CalendarError('not-sent')
    dispatched = true // Losing the response is no longer proof of no write.
    const res = await waitLocally(fetch(apiUrl('/api/calendar/action'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-google-token': token },
      body: json, signal: requestSignal,
    }), requestSignal)
    context!.assertCurrent()
    const data: unknown = await waitLocally(res.json(), requestSignal)
    await waitLocally(auth.scope.validateReadOnly(), requestSignal)
    context!.assertCurrent()
    if (requestSignal.aborted || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    const record = data as Record<string, unknown>
    if (!res.ok) {
      if (record.calendarProtocol === CALENDAR_PROTOCOL && record.calendarOutcome === 'rejected-before-dispatch') throw new CalendarError('rejected-before-dispatch')
      throw new Error()
    }
    return record
  } catch (error) {
    if (error instanceof CalendarError && error.outcome === 'rejected-before-dispatch') throw error
    if (mutation && dispatched) throw new CalendarError('unknown')
    throw new CalendarError('not-sent')
  } finally { dispose() }
}

/** Bounded to 20 events by the proxy; this is not an exhaustive conflict scan. */
export async function listEvents(days = 7, context: CalendarContext | null = captureCalendarContext(), signal?: AbortSignal): Promise<CalendarEvent[]> {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new CalendarError('not-sent', i18n.t('calendarWorkflow.validation.period'))
  const data = await request(context, JSON.stringify({ calendarProtocol: CALENDAR_PROTOCOL, calendarAccount: context?.account, type: 'list', days }), false, signal)
  context!.assertCurrent()
  if (!Array.isArray(data.events)) throw new CalendarError('not-sent', i18n.t('calendarWorkflow.validation.response'))
  return data.events.map((e: unknown) => {
    if (!e || typeof e !== 'object') throw new CalendarError('not-sent')
    const row = e as Record<string, unknown>
    if (['id', 'title', 'start', 'end', 'location', 'description'].some(key => typeof row[key] !== 'string') || !row.id || !Number.isFinite(Date.parse(row.start as string))) throw new CalendarError('not-sent')
    return { id: row.id, title: row.title, start: row.start, end: row.end, location: row.location, description: row.description,
      ...(typeof row.htmlLink === 'string' ? { htmlLink: row.htmlLink } : {}) } as CalendarEvent
  })
}

export interface CalendarMutationResult { id?: string; title?: string; start?: string; link?: string; success?: true }
export interface PreparedCalendarMutation {
  readonly review: string
  readonly payload: Readonly<Record<string, string | number>>
  execute(signal?: AbortSignal): Promise<CalendarMutationResult>
}
/** Prepare BEFORE confirmation. Review and serialized payload share one frozen
 * source; a model-supplied "confirmed" flag cannot confer authority. */
export function prepareCalendarMutation(context: CalendarContext | null, operation: CalendarMutation, draft: Record<string, unknown> = {}, eventId?: string): PreparedCalendarMutation {
  const auth = authority(context)
  if (auth.attempted) throw new CalendarError('already-attempted')
  let payload: Readonly<Record<string, string | number>>
  try { payload = calendarMutationPayload(operation, draft, eventId) }
  catch (error) { throw new CalendarError('not-sent', error instanceof CalendarValidationError ? i18n.t(`calendarWorkflow.validation.${error.code}`) : i18n.t('calendarWorkflow.unavailable')) }
  const json = JSON.stringify({ ...payload, calendarAccount: context!.account })
  const fields = ['eventId', 'title', 'start', 'end', 'location', 'description']
  const review = [i18n.t('calendarWorkflow.account', { account: context!.account }), i18n.t('calendarWorkflow.scope'),
    i18n.t('calendarWorkflow.action', { operation: i18n.t(`calendarWorkflow.operations.${operation}`) }),
    ...Object.entries(payload).filter(([key]) => fields.includes(key)).map(([key, value]) => `${i18n.t(`calendarWorkflow.fields.${key}`)} : ${JSON.stringify(value)}`),
    i18n.t('calendarWorkflow.question')].join('\n')
  let pending: Promise<CalendarMutationResult> | undefined
  return Object.freeze({ payload, review, execute(signal?: AbortSignal) {
    if (pending) return pending.then(async result => {
      try { await auth.scope.validateReadOnly(); context!.assertCurrent(); if (signal?.aborted) throw new Error() }
      catch { throw new CalendarError('unknown') }
      return result
    })
    // Reserve before the first await, including failures during refresh. Another
    // handle/LLM iteration cannot silently retry an uncertain response.
    if (auth.attempted) return Promise.reject(new CalendarError('already-attempted'))
    auth.attempted = true
    pending = request(context, json, true, signal).then(data => {
      try { context!.assertCurrent(); if (signal?.aborted) throw new Error() } catch { throw new CalendarError('unknown') }
      if (operation === 'create') {
        if (typeof data.id !== 'string' || !data.id || typeof data.title !== 'string' || typeof data.start !== 'string' || !Number.isFinite(Date.parse(data.start))) throw new CalendarError('unknown')
        return Object.freeze({ id: data.id, title: data.title, start: data.start, ...(typeof data.link === 'string' ? { link: data.link } : {}) })
      }
      if (data.success !== true || (operation === 'update' && typeof data.title !== 'string')) throw new CalendarError('unknown')
      return Object.freeze({ success: true as const, ...(typeof data.title === 'string' ? { title: data.title } : {}) })
    })
    return pending
  } })
}
