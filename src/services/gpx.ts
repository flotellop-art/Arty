// ─────────────────────────────────────────────────────────────────────────────
// Génération GPX côté client (feature sentiers, juillet 2026).
//
// Entrée : les segments géométriques d'une relation OSM tels que renvoyés par
// /api/geo/trails (un tableau de ways membres, chacun une liste de [lat, lon]).
// L'ordre des membres de la relation est conservé. Leur orientation peut être
// arbitraire quand le rôle OSM ne l'impose pas : chainSegments résout alors
// l'orientation de toute la séquence, sans jamais réordonner les membres, pour
// produire le moins de <trkseg> possibles — un GPS grand
// public (Komoot, Organic Maps…) affiche alors une trace continue au lieu de
// confettis. Quand le réseau est réellement discontinu (tronçons de réseau de
// points-nœuds), plusieurs trkseg subsistent : c'est le comportement honnête.
// ─────────────────────────────────────────────────────────────────────────────

export type LatLon = [number, number]
export interface GpxProvenance { relationId: number; fetchedAt: number }

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

// Tolérance uniquement destinée aux erreurs d'arrondi des coordonnées d'un
// même nœud OSM. Au-delà d'un mètre, la discontinuité reste un <trkseg>
// distinct : jamais de diagonale inventée pour « réparer » la donnée.
const JOIN_TOLERANCE_M = 1

/**
 * Raccorde uniquement des segments CONSÉCUTIFS dans l'ordre de la relation
 * OSM. Un petit programme dynamique choisit le sens des membres réversibles,
 * y compris le premier, afin de minimiser le nombre de chaînes. Les membres
 * forward/backward, déjà orientés au parsing, sont verrouillés et ne sont
 * jamais retournés. En cas d'égalité, l'orientation source est conservée.
 */
export function chainSegments(segments: LatLon[][], directionLocked: boolean[] = []): LatLon[][] {
  const usable = segments.flatMap((points, index) =>
    points.length >= 2 ? [{ points, locked: directionLocked[index] === true }] : []
  )
  if (usable.length === 0) return []

  type Choice = { chains: number; reversals: number; previous: 0 | 1 | null }
  const choices: Array<Array<Choice | null>> = []
  const orientations = (locked: boolean): Array<0 | 1> => locked ? [0] : [0, 1]
  // Toujours copier : la construction des chaînes concatène les points. Une
  // référence source ici muterait la géométrie canonique avant le snapshot.
  const oriented = (points: LatLon[], reversed: 0 | 1): LatLon[] => reversed ? [...points].reverse() : [...points]

  for (let index = 0; index < usable.length; index++) {
    const current = usable[index]!
    choices[index] = [null, null]
    for (const reversed of orientations(current.locked)) {
      if (index === 0) {
        choices[index]![reversed] = { chains: 1, reversals: reversed, previous: null }
        continue
      }
      const currentPoints = oriented(current.points, reversed)
      let best: Choice | null = null
      for (const previousReversed of orientations(usable[index - 1]!.locked)) {
        const previousChoice = choices[index - 1]![previousReversed]
        if (!previousChoice) continue
        const previousPoints = oriented(usable[index - 1]!.points, previousReversed)
        const joins = haversineMeters(previousPoints[previousPoints.length - 1]!, currentPoints[0]!) <= JOIN_TOLERANCE_M
        const candidate: Choice = {
          chains: previousChoice.chains + (joins ? 0 : 1),
          reversals: previousChoice.reversals + reversed,
          previous: previousReversed,
        }
        if (!best || candidate.chains < best.chains ||
          (candidate.chains === best.chains && candidate.reversals < best.reversals)) best = candidate
      }
      choices[index]![reversed] = best
    }
  }

  const lastIndex = usable.length - 1
  let lastOrientation: 0 | 1 = 0
  const endForward = choices[lastIndex]![0]
  const endReverse = choices[lastIndex]![1]
  if (!endForward || (endReverse && (endReverse.chains < endForward.chains ||
    (endReverse.chains === endForward.chains && endReverse.reversals < endForward.reversals)))) {
    lastOrientation = 1
  }
  const resolved = new Array<0 | 1>(usable.length)
  for (let index = lastIndex; index >= 0; index--) {
    resolved[index] = lastOrientation
    lastOrientation = choices[index]![lastOrientation]!.previous ?? 0
  }

  const chains: LatLon[][] = []
  for (let index = 0; index < usable.length; index++) {
    const segment = oriented(usable[index]!.points, resolved[index]!)
    const chain = chains[chains.length - 1]
    if (!chain) {
      chains.push(segment)
      continue
    }
    const tail = chain[chain.length - 1]!
    const start = segment[0]!
    if (haversineMeters(tail, start) <= JOIN_TOLERANCE_M) {
      chain.push(...segment.slice(1))
    } else {
      chains.push([...segment])
    }
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
export function buildGpx(name: string, chains: LatLon[][], provenance?: GpxProvenance): string {
  const safeName = escapeXml(name.slice(0, 120))
  const safeProvenance = provenance && Number.isSafeInteger(provenance.relationId) && provenance.relationId > 0 &&
    Number.isFinite(provenance.fetchedAt) && provenance.fetchedAt > 0
    // Ordre metadataType GPX 1.1 : link* précède time.
    ? `\n    <link href="https://www.openstreetmap.org/relation/${provenance.relationId}"><text>Relation OpenStreetMap ${provenance.relationId}</text></link>` +
      `\n    <time>${new Date(provenance.fetchedAt).toISOString()}</time>`
    : ''
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
    `  <metadata>\n    <name>${safeName}</name>${safeProvenance}\n  </metadata>\n` +
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
