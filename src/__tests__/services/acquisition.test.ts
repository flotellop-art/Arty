// Attribution first-party pubs (services/acquisition.ts) — first-touch,
// allowlist stricte, TTL 30 jours, consommation après persistance serveur.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACQUISITION_KEY,
  captureAcquisition,
  consumeAcquisition,
  getAcquisition,
  hasStartParam,
  readAcquisitionFromSearch,
} from '../../services/acquisition'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('readAcquisitionFromSearch', () => {
  it('capture les champs allowlistés et ignore le reste', () => {
    const acq = readAcquisitionFromSearch(
      '?start=1&utm_source=meta&utm_campaign=agenda&lp=agenda&evil=<script>&foo=bar'
    )
    expect(acq).toMatchObject({ utm_source: 'meta', utm_campaign: 'agenda', lp: 'agenda' })
    expect(acq).not.toHaveProperty('evil')
    expect(acq).not.toHaveProperty('start')
  })

  it('retourne null sans paramètre pertinent', () => {
    expect(readAcquisitionFromSearch('?start=1&hello=world')).toBeNull()
    expect(readAcquisitionFromSearch('')).toBeNull()
  })

  it('sanitise les valeurs (caractères hostiles retirés, longueur bornée)', () => {
    const acq = readAcquisitionFromSearch(`?utm_source=<img onerror=x>meta"'&utm_term=${'a'.repeat(500)}`)
    expect(acq?.utm_source).toBe('img onerrorxmeta')
    expect(acq?.utm_term?.length).toBeLessThanOrEqual(120)
  })
})

describe('captureAcquisition / getAcquisition (first-touch + TTL)', () => {
  function setSearch(search: string): void {
    window.history.replaceState(null, '', `/${search}`)
  }

  it('capture au boot puis ne ré-écrase pas (first-touch)', () => {
    setSearch('?utm_source=meta&utm_campaign=agenda')
    captureAcquisition()
    expect(getAcquisition()?.utm_campaign).toBe('agenda')

    setSearch('?utm_source=meta&utm_campaign=prix')
    captureAcquisition()
    expect(getAcquisition()?.utm_campaign).toBe('agenda')
  })

  it('purge et ignore une attribution expirée (>30 jours)', () => {
    const old = { ts: Date.now() - 31 * 24 * 60 * 60 * 1000, utm_campaign: 'agenda' }
    localStorage.setItem(ACQUISITION_KEY, JSON.stringify(old))
    expect(getAcquisition()).toBeNull()
    expect(localStorage.getItem(ACQUISITION_KEY)).toBeNull()
  })

  it('tolère un blob illisible (écrit par lp.js corrompu) sans throw', () => {
    localStorage.setItem(ACQUISITION_KEY, '{pas du json')
    expect(getAcquisition()).toBeNull()
  })

  it('re-sanitise les champs venant de lp.js (hors typecheck)', () => {
    localStorage.setItem(
      ACQUISITION_KEY,
      JSON.stringify({ ts: Date.now(), lp: 'agenda"><script>', utm_source: 'meta' })
    )
    expect(getAcquisition()?.lp).toBe('agendascript')
  })

  it('consumeAcquisition supprime la clé', () => {
    localStorage.setItem(ACQUISITION_KEY, JSON.stringify({ ts: Date.now(), lp: 'agenda' }))
    consumeAcquisition()
    expect(localStorage.getItem(ACQUISITION_KEY)).toBeNull()
  })
})

describe('hasStartParam (?start=1 → entrée directe onboarding)', () => {
  it('détecte start et ignore le reste', () => {
    expect(hasStartParam('?start=1&utm_source=meta')).toBe(true)
    expect(hasStartParam('?start')).toBe(true)
    expect(hasStartParam('?utm_source=meta')).toBe(false)
    expect(hasStartParam('')).toBe(false)
  })
})
