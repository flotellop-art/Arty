// ─────────────────────────────────────────────────────────────────────────────
// Simplification de polylignes pour le plafond de points de /api/geo/trails.
//
// Exigence (synthèse 3 IA + agents, juillet 2026) : le plafond ~4000 points
// doit être une SIMPLIFICATION topologique, jamais une troncature ni une
// décimation aveugle — sinon la trace affichée et le GPX divergent du terrain.
// Douglas-Peucker par segment : extrémités toujours préservées, segments
// disjoints jamais fusionnés ni supprimés, tolérance métrique escaladée
// jusqu'à passer sous le plafond. La longueur affichée reste calculée sur la
// géométrie SOURCE par l'appelant (avant simplification).
// ─────────────────────────────────────────────────────────────────────────────

export type SimplifyPoint = [number, number] // [lat, lon]

const METERS_PER_DEG_LAT = 111_320

/** Distance perpendiculaire (m) d'un point à un segment, en projection
 *  équirectangulaire locale — largement suffisant à l'échelle d'une rando. */
function perpendicularDistanceM(p: SimplifyPoint, a: SimplifyPoint, b: SimplifyPoint): number {
  const cosLat = Math.cos((a[0] * Math.PI) / 180)
  const ax = a[1] * cosLat * METERS_PER_DEG_LAT
  const ay = a[0] * METERS_PER_DEG_LAT
  const bx = b[1] * cosLat * METERS_PER_DEG_LAT
  const by = b[0] * METERS_PER_DEG_LAT
  const px = p[1] * cosLat * METERS_PER_DEG_LAT
  const py = p[0] * METERS_PER_DEG_LAT

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Douglas-Peucker itératif (pile explicite — pas de récursion : un way de
 *  plusieurs milliers de points quasi colinéaires ferait déborder la stack). */
export function douglasPeucker(points: SimplifyPoint[], toleranceM: number): SimplifyPoint[] {
  if (points.length <= 2) return points
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    const a = points[start]
    const b = points[end]
    if (!a || !b) continue
    let maxDist = 0
    let maxIdx = -1
    for (let i = start + 1; i < end; i++) {
      const p = points[i]
      if (!p) continue
      const d = perpendicularDistanceM(p, a, b)
      if (d > maxDist) {
        maxDist = d
        maxIdx = i
      }
    }
    if (maxIdx > 0 && maxDist > toleranceM) {
      keep[maxIdx] = true
      stack.push([start, maxIdx], [maxIdx, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

/**
 * Simplifie un ensemble de segments pour tenir sous `maxPoints` au total.
 * Tolérance de départ 5 m, doublée jusqu'à passer sous le plafond (bornée à
 * ~640 m — au-delà, on accepte le dépassement plutôt que détruire la forme).
 */
export function simplifySegments(
  segments: SimplifyPoint[][],
  maxPoints: number
): { segments: SimplifyPoint[][]; toleranceM: number } {
  const total = segments.reduce((n, s) => n + s.length, 0)
  if (total <= maxPoints) return { segments, toleranceM: 0 }

  let toleranceM = 5
  let result = segments
  for (let i = 0; i < 8; i++) {
    result = segments.map((seg) => douglasPeucker(seg, toleranceM))
    const count = result.reduce((n, s) => n + s.length, 0)
    if (count <= maxPoints) return { segments: result, toleranceM }
    toleranceM *= 2
  }
  return { segments: result, toleranceM }
}
