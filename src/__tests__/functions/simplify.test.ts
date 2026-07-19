// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { douglasPeucker, simplifySegments, type SimplifyPoint } from '../../../functions/api/_lib/simplify'

// Simplification du plafond de points de /api/geo/trails — exigence produit :
// jamais de troncature, extrémités préservées, segments disjoints intacts.

const line = (n: number, jitter = 0): SimplifyPoint[] =>
  Array.from({ length: n }, (_, i) => [45.3 + i * 1e-4, 5.2 + (i % 2) * jitter])

describe('douglasPeucker', () => {
  it('réduit une ligne droite à ses deux extrémités', () => {
    const out = douglasPeucker(line(1000), 5)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual([45.3, 5.2])
    expect(out[1]).toEqual([45.3 + 999 * 1e-4, 5.2])
  })

  it('préserve un point saillant au-dessus de la tolérance', () => {
    const pts: SimplifyPoint[] = [
      [45.3, 5.2],
      [45.301, 5.21], // écart ~780 m du segment direct
      [45.302, 5.2],
    ]
    expect(douglasPeucker(pts, 50)).toHaveLength(3)
  })

  it('ne touche pas aux segments de 2 points', () => {
    const pts: SimplifyPoint[] = [[45.3, 5.2], [45.31, 5.21]]
    expect(douglasPeucker(pts, 1000)).toEqual(pts)
  })

  it('tient sur un long segment quasi colinéaire sans déborder la pile', () => {
    expect(() => douglasPeucker(line(20000, 1e-7), 5)).not.toThrow()
  })
})

describe('simplifySegments', () => {
  it('ne modifie rien sous le plafond', () => {
    const segments = [line(100), line(50)]
    const { segments: out, toleranceM } = simplifySegments(segments, 4000)
    expect(out).toBe(segments)
    expect(toleranceM).toBe(0)
  })

  it('passe sous le plafond en préservant chaque segment et ses extrémités', () => {
    const segA = line(6000, 5e-5) // zigzag
    const segB = line(6000, 5e-5)
    const { segments: out } = simplifySegments([segA, segB], 4000)
    expect(out).toHaveLength(2) // jamais de fusion ni de suppression de segment
    expect(out.reduce((n, s) => n + s.length, 0)).toBeLessThanOrEqual(4000)
    const outA = out[0]!
    const outB = out[1]!
    expect(outA[0]).toEqual(segA[0])
    expect(outA[outA.length - 1]).toEqual(segA[segA.length - 1])
    expect(outB[0]).toEqual(segB[0])
    expect(outB[outB.length - 1]).toEqual(segB[segB.length - 1])
  })
})
