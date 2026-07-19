// ─────────────────────────────────────────────────────────────────────────────
// Génération GPX côté client (feature sentiers, juillet 2026).
//
// Entrée : les segments géométriques d'une relation OSM tels que renvoyés par
// /api/geo/trails (un tableau de ways membres, chacun une liste de [lat, lon]).
// Les membres d'une relation OSM ne sont PAS garantis ordonnés ni orientés :
// chainSegments les raccorde par un glouton d'extrémités (avec inversion si
// nécessaire) pour produire le moins de <trkseg> possibles — un GPS grand
// public (Komoot, Organic Maps…) affiche alors une trace continue au lieu de
// confettis. Quand le réseau est réellement discontinu (tronçons de réseau de
// points-nœuds), plusieurs trkseg subsistent : c'est le comportement honnête.
// ─────────────────────────────────────────────────────────────────────────────

export type LatLon = [number, number]

/** Distance haversine en mètres. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** Longueur totale d'une polyligne en kilomètres. */
export function polylineKm(points: LatLon[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a && b) m += haversineMeters(a, b)
  }
  return m / 1000
}

// Tolérance de raccord entre deux extrémités de ways. 40 m absorbe les petits
// trous de cartographie OSM sans fusionner des tronçons réellement disjoints.
const JOIN_TOLERANCE_M = 40

/**
 * Raccorde des segments non ordonnés en chaînes continues (glouton par
 * extrémités, inversion autorisée). Pure et déterministe : part du premier
 * segment, étend la chaîne tant qu'une extrémité libre matche, puis recommence
 * avec le prochain segment non consommé.
 */
export function chainSegments(segments: LatLon[][]): LatLon[][] {
  const remaining = segments.filter((s) => s.length >= 2).map((s) => [...s])
  const chains: LatLon[][] = []

  while (remaining.length > 0) {
    const chain = remaining.shift()
    if (!chain) break
    let extended = true
    while (extended) {
      extended = false
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i]
        const head = chain[0]
        const tail = chain[chain.length - 1]
        const segStart = seg?.[0]
        const segEnd = seg?.[seg.length - 1]
        if (!seg || !head || !tail || !segStart || !segEnd) continue
        if (haversineMeters(tail, segStart) <= JOIN_TOLERANCE_M) {
          chain.push(...seg.slice(1))
        } else if (haversineMeters(tail, segEnd) <= JOIN_TOLERANCE_M) {
          chain.push(...[...seg].reverse().slice(1))
        } else if (haversineMeters(head, segEnd) <= JOIN_TOLERANCE_M) {
          chain.unshift(...seg.slice(0, -1))
        } else if (haversineMeters(head, segStart) <= JOIN_TOLERANCE_M) {
          chain.unshift(...[...seg].reverse().slice(0, -1))
        } else {
          continue
        }
        remaining.splice(i, 1)
        extended = true
        break
      }
    }
    chains.push(chain)
  }
  return chains
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Construit un document GPX 1.1 à partir de chaînes de points. Le nom est
 * échappé XML — il peut venir d'un tag OSM libre (contenu tiers non fiable).
 */
export function buildGpx(name: string, chains: LatLon[][]): string {
  const safeName = escapeXml(name.slice(0, 120))
  const segs = chains
    .filter((c) => c.length >= 2)
    .map(
      (c) =>
        '    <trkseg>\n' +
        c.map((p) => `      <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('\n') +
        '\n    </trkseg>'
    )
    .join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="Arty" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    `  <metadata><name>${safeName}</name></metadata>\n` +
    '  <trk>\n' +
    `    <name>${safeName}</name>\n` +
    segs +
    '\n  </trk>\n' +
    '</gpx>\n'
  )
}

/**
 * Nom de fichier sûr dérivé d'un libellé potentiellement hostile (tag OSM
 * `name` éditable par n'importe qui). `writeLocalFile`/`Filesystem.writeFile`
 * n'ont AUCUNE sanitisation (recursive:true) : le slug est la seule garde
 * contre `../../evil` — jamais de séparateur, jamais de point de tête,
 * extension .gpx forcée ici.
 */
export function gpxFilename(label: string, fallback: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 60)
  return `${slug || fallback}.gpx`
}
