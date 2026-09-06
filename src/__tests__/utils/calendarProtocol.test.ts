import { describe, expect, it } from 'vitest'
import { calendarDateTime, calendarMutationPayload } from '../../utils/calendarProtocol'

describe('Agenda v1 — dates Paris et allowlist commune client/proxy', () => {
  it.each([
    ['2026-01-15T09:00', '2026-01-15T09:00:00+01:00'],
    ['2026-07-15T09:00', '2026-07-15T09:00:00+02:00'],
    ['2026-07-15T07:00:00Z', '2026-07-15T09:00:00+02:00'],
    ['2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+02:00'],
    ['2026-10-25T02:30:00+01:00', '2026-10-25T02:30:00+01:00'],
  ])('normalise %s indépendamment du fuseau appareil', (value, expected) => {
    expect(calendarDateTime(value)).toBe(expected)
  })
  it.each(['2026-02-30T09:00', '2026-03-29T02:30', '2026-10-25T02:30', '2026-07-15', 'invalid'])('refuse %s sans inventer un instant', value => {
    expect(() => calendarDateTime(value)).toThrow()
  })
  it('fige opération/cible et distingue absent et vide', () => {
    expect(calendarMutationPayload('update', { title: ' T ', location: '', type: 'delete', eventId: 'other' }, 'original'))
      .toEqual({ calendarProtocol: 1, type: 'update', eventId: 'original', title: 'T', location: '' })
    expect(calendarMutationPayload('delete', {}, 'all-day-id')).toEqual({ calendarProtocol: 1, type: 'delete', eventId: 'all-day-id' })
  })
  it('exige une paire de dates explicites ordonnées pour créer ou changer les heures', () => {
    for (const draft of [{ title: 'T', start: '2026-07-15T09:00' }, { title: 'T', start: '2026-07-15T09:00', end: '2026-07-15T08:00' }]) {
      expect(() => calendarMutationPayload('create', draft)).toThrow()
    }
    expect(() => calendarMutationPayload('update', { start: '2026-07-15T09:00' }, 'id')).toThrow()
  })
})
