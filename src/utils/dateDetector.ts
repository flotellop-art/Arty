/**
 * Lightweight date/time detection for French user messages.
 * Returns the matched substring and a parsed Date object, or null.
 *
 * Handles:
 *  - "demain", "aujourd'hui", "après-demain"
 *  - "lundi", "mardi" ... (next weekday)
 *  - "lundi prochain", "vendredi prochain"
 *  - "le 20", "le 20 avril", "le 20/04", "le 20-04-2026"
 *  - optional time: "à 14h", "à 14h30", "à 14:30"
 */

const WEEKDAYS: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
}

const MONTHS: Record<string, number> = {
  janvier: 0, fevrier: 1, 'février': 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, 'août': 7, septembre: 8, octobre: 9, novembre: 10, 'décembre': 11, decembre: 11,
}

export interface DetectedDate {
  match: string
  date: Date
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
}

function nextWeekday(from: Date, targetDay: number, forceNextWeek: boolean): Date {
  const current = from.getDay()
  let diff = (targetDay - current + 7) % 7
  if (diff === 0) diff = 7
  if (forceNextWeek && diff < 7) diff += 7
  return addDays(from, diff)
}

function parseTime(str: string): { hour: number; minute: number } | null {
  const m = str.match(/(\d{1,2})\s*(?:h|:)\s*(\d{0,2})/i)
  if (!m) return null
  const hour = parseInt(m[1] || '0', 10)
  const minute = m[2] ? parseInt(m[2], 10) : 0
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/**
 * Detect a date/time expression in the text and return it as a parsed Date.
 * Returns null if no reliable match is found.
 */
export function detectDates(text: string): DetectedDate | null {
  const lower = text.toLowerCase()
  const now = new Date()
  now.setSeconds(0, 0)

  // Aujourd'hui / demain / après-demain
  const todayRe = /\b(aujourd['' ]?hui|demain|apr[eè]s[- ]demain)\b(?:\s+[aà]\s+(\d{1,2}\s*(?:h|:)\s*\d{0,2}))?/i
  const m1 = lower.match(todayRe)
  if (m1) {
    let base = new Date(now)
    if (m1[1]?.startsWith('apr')) base = addDays(base, 2)
    else if (m1[1] === 'demain') base = addDays(base, 1)
    base.setHours(9, 0, 0, 0)
    const time = m1[2] ? parseTime(m1[2]) : null
    if (time) base.setHours(time.hour, time.minute, 0, 0)
    return { match: m1[0], date: base }
  }

  // Weekdays (optional "prochain")
  const weekdayRe = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?:\s+(prochain))?(?:\s+[aà]\s+(\d{1,2}\s*(?:h|:)\s*\d{0,2}))?/i
  const m2 = lower.match(weekdayRe)
  if (m2 && m2[1]) {
    const targetDay = WEEKDAYS[m2[1]]
    if (targetDay !== undefined) {
      const forceNext = !!m2[2]
      const base = nextWeekday(now, targetDay, forceNext)
      base.setHours(9, 0, 0, 0)
      const time = m2[3] ? parseTime(m2[3]) : null
      if (time) base.setHours(time.hour, time.minute, 0, 0)
      return { match: m2[0], date: base }
    }
  }

  // "le 20 avril" or "le 20"
  const dayMonthRe = /\ble\s+(\d{1,2})(?:\s+(janvier|f[eé]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[eé]cembre))?(?:\s+(\d{4}))?(?:\s+[aà]\s+(\d{1,2}\s*(?:h|:)\s*\d{0,2}))?/i
  const m3 = lower.match(dayMonthRe)
  if (m3 && m3[1]) {
    const day = parseInt(m3[1], 10)
    let month = now.getMonth()
    let year = now.getFullYear()
    if (m3[2]) {
      const mm = MONTHS[m3[2]]
      if (mm !== undefined) month = mm
    }
    if (m3[3]) year = parseInt(m3[3], 10)
    if (day >= 1 && day <= 31) {
      const base = new Date(year, month, day, 9, 0, 0, 0)
      // If that date is already in the past and no month given, assume next month
      if (!m3[2] && base.getTime() < now.getTime()) {
        base.setMonth(base.getMonth() + 1)
      }
      const time = m3[4] ? parseTime(m3[4]) : null
      if (time) base.setHours(time.hour, time.minute, 0, 0)
      return { match: m3[0], date: base }
    }
  }

  // dd/mm or dd/mm/yyyy
  const numericRe = /\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?(?:\s+[aà]\s+(\d{1,2}\s*(?:h|:)\s*\d{0,2}))?/i
  const m4 = lower.match(numericRe)
  if (m4 && m4[1] && m4[2]) {
    const day = parseInt(m4[1], 10)
    const month = parseInt(m4[2], 10) - 1
    let year = now.getFullYear()
    if (m4[3]) {
      const y = parseInt(m4[3], 10)
      year = y < 100 ? 2000 + y : y
    }
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const base = new Date(year, month, day, 9, 0, 0, 0)
      const time = m4[4] ? parseTime(m4[4]) : null
      if (time) base.setHours(time.hour, time.minute, 0, 0)
      return { match: m4[0], date: base }
    }
  }

  return null
}
