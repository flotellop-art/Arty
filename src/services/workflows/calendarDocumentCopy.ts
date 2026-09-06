import type { Conversation } from '../../types'
import { captureConversationForBackup } from '../storage'
import { captureCalendarContext, prepareCalendarMutation, CalendarError, type PreparedCalendarMutation } from '../calendarClient'
import { getActiveSession } from '../userSession'

export const CALENDAR_COPY_TEXT_LIMIT = 200_000
export class CalendarCopyError extends Error {
  constructor(readonly code: 'unavailable' | 'connection' | 'source' | 'busy' | 'changed' | 'state' | 'limit') { super(`calendarCopy.errors.${code}`) }
}
const fail = (code: CalendarCopyError['code']): never => { throw new CalendarCopyError(code) }
/** JSON data only. Imported text and cached accessors never confer authority. */
function field(value: unknown, key: string, required = true): unknown {
  if (!value || typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) return fail('source')
  const d = Object.getOwnPropertyDescriptor(value, key)
  if (!d) return required ? fail('source') : undefined
  if (!('value' in d) || !d.enumerable) return fail('source')
  return d.value
}
function string(value: unknown, max: number, nonempty = true): string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) return fail('source')
  if (value.length > max) return fail('limit')
  return value
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail('source')
  return value as number
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail('source')
  if (value.length > max) return fail('limit')
  return Array.from({ length: value.length }, (_, i) => field(value, String(i)))
}
export interface CalendarCopySource {
  readonly conversationId: string; readonly messageId: string; readonly title: string
  readonly text: string; readonly timestamp: number; readonly references: readonly string[]
  readonly verificationPending: boolean
}
function mapSource(conversation: Conversation, messageId: string): CalendarCopySource {
  const messages = array(field(conversation, 'messages'), 20_000)
  // A saved live placeholder is never a completed source, even before the UI
  // receives a render indicating work. Other message contents are not copied.
  if (messages.some(m => field(m, 'id') === 'streaming')) return fail('busy')
  const matches = messages.filter(m => field(m, 'id') === messageId)
  if (matches.length !== 1) return fail('source')
  const m = matches[0]
  if (field(m, 'role') !== 'assistant' || field(m, 'interrupted', false)) return fail('source')
  const factCheck = field(m, 'factCheck', false)
  const verificationPending = !!factCheck && (field(factCheck, 'status', false) === 'pending' ||
    (field(factCheck, 'status', false) === undefined && field(factCheck, 'modelLabel', false) === 'Vérification en cours…'))
  const references: string[] = []
  const turn = field(m, 'projectTurn', false)
  if (turn !== undefined) {
    for (const [i, ref] of array(field(turn, 'sources'), 100).entries()) {
      const hash = string(field(ref, 'sourceHash'), 64)
      if (!/^[a-f0-9]{64}$/i.test(hash)) return fail('source')
      references.push(`[S${i + 1}] ${string(field(ref, 'name'), 255)} · ${integer(field(ref, 'startLine'))}–${integer(field(ref, 'endLine'))} · SHA-256 ${hash}`)
    }
  }
  const timestamp = integer(field(m, 'timestamp'))
  if (!Number.isFinite(new Date(timestamp).getTime())) return fail('source')
  return Object.freeze({ conversationId: string(field(conversation, 'id'), 128), messageId,
    title: string(field(conversation, 'title'), 255), text: string(field(m, 'content'), CALENDAR_COPY_TEXT_LIMIT),
    timestamp, verificationPending, references: Object.freeze(references) })
}

/** Source stability ends at explicit adoption, not at the eventual Google
 * request. The original Calendar authority outlives adoption but never relink. */
export function captureCalendarDocumentCopy(conversationId: string, messageId: string, options: { isBusy(id: string): boolean }) {
  string(conversationId, 128); string(messageId, 128)
  if (getActiveSession()?.authMethod === 'demo') return fail('unavailable')
  const controller = new AbortController(), context = captureCalendarContext(controller.signal)
  if (!context) return fail('connection')
  let adopted = false, adopting = false, disposed = false, attempted = false, confirmed = false, reviewRevision = 0
  let ticket: ReturnType<typeof captureConversationForBackup<CalendarCopySource>> | null
  try {
    if (options.isBusy(conversationId)) return fail('busy')
    ticket = captureConversationForBackup(conversationId, source => mapSource(source, messageId))
  } catch (error) { controller.abort(); throw error instanceof CalendarCopyError ? error : new CalendarCopyError('unavailable') }
  const source = ticket.snapshot
  const assertCurrent = () => {
    if (disposed) return fail('changed')
    try {
      context.assertCurrent()
      if (!adopted) {
        if (options.isBusy(conversationId)) return fail('busy')
        ticket!.assertSnapshot((a, b) => JSON.stringify(a) === JSON.stringify(b))
      }
    } catch (error) { throw error instanceof CalendarCopyError ? error : new CalendarCopyError('changed') }
  }
  const validate = async () => {
    assertCurrent()
    try { await context.validateReadOnly() } catch { return fail('changed') }
    assertCurrent()
  }
  const actor = Object.freeze({
    conversationId,
    get hasAttempted() { return attempted },
    get hasConfirmed() { return confirmed },
    get source() { assertCurrent(); return source },
    get account() { assertCurrent(); return context.account },
    assertCurrent, validate,
    discardReview() { ++reviewRevision },
    async adopt() {
      if (adopted || adopting || attempted) return fail('state')
      adopting = true
      try { await validate(); assertCurrent(); adopted = true; ticket = null }
      finally { adopting = false }
    },
    prepare(draft: Record<string, unknown>): PreparedCalendarMutation {
      assertCurrent()
      if (!adopted || attempted) return fail('state')
      const revision = ++reviewRevision
      const prepared = prepareCalendarMutation(context, 'create', draft)
      return Object.freeze({ review: prepared.review, payload: prepared.payload, async execute() {
        assertCurrent()
        if (attempted || revision !== reviewRevision) return fail('state')
        attempted = true
        const result = await prepared.execute(controller.signal)
        try { assertCurrent() } catch { throw new CalendarError('unknown') }
        confirmed = true
        return result
      } })
    },
    dispose() { disposed = true; ++reviewRevision; ticket = null; controller.abort() },
  })
  assertCurrent()
  return actor
}
export type CalendarDocumentCopy = ReturnType<typeof captureCalendarDocumentCopy>
