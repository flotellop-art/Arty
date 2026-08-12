import { describe, expect, it, vi } from 'vitest'
import { toLocalCalendarDateTime } from '../../utils/calendarDateTime'

describe('toLocalCalendarDateTime', () => {
  it('préserve l’heure murale choisie au lieu de la convertir en UTC', () => {
    vi.stubEnv('TZ', 'Europe/Paris')
    const selected = new Date(2026, 7, 13, 14, 5, 0)

    expect(toLocalCalendarDateTime(selected)).toBe('2026-08-13T14:05:00')
    expect(selected.toISOString()).toContain('12:05:00')

    vi.unstubAllEnvs()
  })
})
