import { describe, expect, it } from 'vitest'
import { segmentsKmWithinRadius } from '../../../functions/api/_lib/geoDistance'

describe('segmentsKmWithinRadius', () => {
  const center = { lat: 0, lon: 0 }

  it('ne compte que la portion qui traverse le cercle', () => {
    const km = segmentsKmWithinRadius([[[-0.02, 0], [0.02, 0]]], center, 1000)
    expect(km).toBeGreaterThan(1.99)
    expect(km).toBeLessThan(2.01)
  })

  it('exclut un segment situé dans un coin de la bbox mais hors du cercle', () => {
    const km = segmentsKmWithinRadius([[[0.009, 0.009], [0.009, 0.01]]], center, 1000)
    expect(km).toBe(0)
  })

  it('conserve intégralement un segment intérieur', () => {
    const km = segmentsKmWithinRadius([[[0, 0], [0.004, 0]]], center, 1000)
    expect(km).toBeGreaterThan(0.44)
    expect(km).toBeLessThan(0.45)
  })
})
