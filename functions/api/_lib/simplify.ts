// ─────────────────────────────────────────────────────────────────────────────
// Simplification de polylignes pour le plafond de points de /api/geo/trails.
//
// Exigence (synthèse 3 IA + agents, juillet 2026) : le plafond ~4000 points
// doit être une SIMPLIFICATION topologique, jamais une troncature ni une
// décimation aveugle — sinon la trace affichée et le GPX divergent du terrain.
// Douglas-Peucker par segment : extrémités toujours préservées, segments
// disjoints jamais fusionnés ni supprimés. La tolérance métrique est bornée :
// si le budget de points ne peut pas être atteint sans déformer le sentier,
// on conserve davantage de points plutôt que d'augmenter silencieusement
// l'erreur jusqu'à plusieurs centaines de mètres. La longueur affichée reste
// calculée sur la géométrie SOURCE par l'appelant (avant simplification).
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
 * Simplifie un ensemble de segments en visant `maxPoints` au total, sans
 * jamais dépasser `maxToleranceM`. Le plafond de points est un objectif de
 * performance, pas une autorisation de déformer le terrain.
 */
export function simplifySegments(
  segments: SimplifyPoint[][],
  maxPoints: number,
  maxToleranceM = 5
): { segments: SimplifyPoint[][]; toleranceM: number } {
  const total = segments.reduce((n, s) => n + s.length, 0)
  if (total <= maxPoints) return { segments, toleranceM: 0 }

  const toleranceLimit = Math.max(0, maxToleranceM)
  if (toleranceLimit === 0) return { segments, toleranceM: 0 }

  // Une seule passe à la borne contractuelle. Les essais 1→2→4→5 m avaient
  // le même plafond d'erreur final, mais un zigzag dense déclenche le pire cas
  // quadratique de Douglas-Peucker à chaque tolérance trop faible.
  const result = segments.map((segment) => douglasPeucker(segment, toleranceLimit))
  return { segments: result, toleranceM: toleranceLimit }
}
