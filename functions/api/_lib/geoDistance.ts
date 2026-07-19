export type GeoPoint = [number, number]

const EARTH_RADIUS_M = 6_371_000

function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const value = sinLat ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLon ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(value))
}

/** Longueur des portions de polyligne réellement situées dans un cercle.
 * La recherche Overpass renvoie une bbox carrée un peu plus large ; ce clip
 * métrique empêche ses coins de gonfler la distance locale annoncée. */
export function segmentsKmWithinRadius(
  segments: GeoPoint[][],
  center: { lat: number; lon: number },
  radiusM: number
): number {
  const centerLatRad = center.lat * Math.PI / 180
  const toXY = ([lat, lon]: GeoPoint): [number, number] => [
    (lon - center.lon) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(centerLatRad),
    (lat - center.lat) * Math.PI / 180 * EARTH_RADIUS_M,
  ]
  let meters = 0
  for (const points of segments) {
    for (let index = 1; index < points.length; index++) {
      const start = points[index - 1]!
      const end = points[index]!
      const [ax, ay] = toXY(start)
      const [bx, by] = toXY(end)
      const dx = bx - ax
      const dy = by - ay
      const quadraticA = dx * dx + dy * dy
      if (quadraticA < 1e-9) continue
      const quadraticB = 2 * (ax * dx + ay * dy)
      const quadraticC = ax * ax + ay * ay - radiusM * radiusM
      const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC
      if (discriminant < 0) continue
      const root = Math.sqrt(discriminant)
      const first = (-quadraticB - root) / (2 * quadraticA)
      const second = (-quadraticB + root) / (2 * quadraticA)
      const from = Math.max(0, Math.min(first, second))
      const to = Math.min(1, Math.max(first, second))
      if (to > from) meters += haversineMeters(start, end) * (to - from)
    }
  }
  return meters / 1000
}
