/** Pure, shared with Pages. v1 is additive: legacy APKs keep their contract. */
export const CALENDAR_PROTOCOL = 1
export type CalendarMutation = 'create' | 'update' | 'delete'
export class CalendarValidationError extends Error {
  constructor(readonly code: 'date' | 'eventId' | 'operation' | 'field' | 'title' | 'interval' | 'noChanges') { super(code) }
}
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/
const paris = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const wallClock = (date: Date) => {
  const parts = Object.fromEntries(paris.formatToParts(date).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}
const invalidDate = () => new CalendarValidationError('date')

export function calendarDateTime(value: unknown): string {
  if (typeof value !== 'string') throw invalidDate()
  const match = DATE_TIME.exec(value)
  if (!match) throw invalidDate()
  const [, y, mo, d, h, mi, s = '00', zone] = match
  const wall = `${y}-${mo}-${d}T${h}:${mi}:${s}`
  const utc = new Date(`${wall}Z`)
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 19) !== wall || Number(y) < 2000 || Number(y) > 2199) throw invalidDate()
  let instant: Date
  if (zone) {
    instant = new Date(`${wall}${zone}`)
    if (!Number.isFinite(instant.getTime())) throw invalidDate()
  } else {
    // Verify both Paris offsets with IANA rules; never guess a DST gap/fold.
    const candidates = [1, 2].map(offset => new Date(utc.getTime() - offset * 3600_000)).filter(date => wallClock(date) === wall)
    if (candidates.length !== 1) throw invalidDate()
    instant = candidates[0]!
  }
  const local = wallClock(instant)
  const offset = (new Date(`${local}Z`).getTime() - instant.getTime()) / 3600_000
  if (offset !== 1 && offset !== 2) throw invalidDate()
  return `${local}+0${offset}:00`
}

export function calendarEventId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || !/^[a-zA-Z0-9_@.+\-=]+$/.test(value)) throw new CalendarValidationError('eventId')
  return value
}

export function calendarMutationPayload(operation: CalendarMutation, draft: Record<string, unknown>, eventId?: string): Readonly<Record<string, string | number>> {
  if (!['create', 'update', 'delete'].includes(operation)) throw new CalendarValidationError('operation')
  const body: Record<string, string | number> = { calendarProtocol: CALENDAR_PROTOCOL, type: operation }
  if (operation !== 'create') body.eventId = calendarEventId(eventId)
  if (operation !== 'delete') {
    for (const field of ['title', 'location', 'description'] as const) {
      const value = draft[field]
      if (value === undefined) continue
      if (typeof value !== 'string' || value.length > (field === 'description' ? 8192 : 1024)) throw new CalendarValidationError('field')
      if (field === 'title' && !value.trim()) throw new CalendarValidationError('title')
      body[field] = field === 'title' ? value.trim() : value
    }
    if (operation === 'create' && !body.title) throw new CalendarValidationError('title')
    if (operation === 'create' || draft.start !== undefined || draft.end !== undefined) {
      body.start = calendarDateTime(draft.start); body.end = calendarDateTime(draft.end)
      if (Date.parse(body.end) <= Date.parse(body.start)) throw new CalendarValidationError('interval')
    }
    if (operation === 'update' && Object.keys(body).length === 3) throw new CalendarValidationError('noChanges')
  }
  return Object.freeze(body)
}
