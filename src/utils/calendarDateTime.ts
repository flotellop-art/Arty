/**
 * Google Calendar receives local wall-clock values and applies Europe/Paris on
 * the server. Using Date#toISOString here would first convert the user's choice
 * to UTC and shift it by one or two hours.
 */
export function toLocalCalendarDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
