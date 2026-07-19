import { describe, expect, it } from 'vitest'
import { buildGpx, chainSegments, gpxFilename, polylineKm, type LatLon } from '../../services/gpx'

// Points espacés d'environ 100 m en latitude (0.0009° ≈ 100 m).
const p = (i: number): LatLon => [45.3 + i * 0.0009, 5.2]

describe('chainSegments — orientation sans réordonner les ways OSM', () => {
  it('raccorde deux segments contigus en une seule chaîne', () => {
    const source = [
      [p(0), p(1), p(2)],
      [p(2), p(3), p(4)],
    ] as LatLon[][]
    const before = structuredClone(source)
    const chains = chainSegments(source)
    expect(chains).toHaveLength(1)
    expect(chains[0]).toHaveLength(5)
    expect(chains[0][0]).toEqual(p(0))
    expect(chains[0][4]).toEqual(p(4))
    expect(source).toEqual(before)
  })

  it('inverse le membre suivant sans changer l’ordre de la relation', () => {
    const chains = chainSegments([
      [p(0), p(1), p(2)],
      [p(4), p(3), p(2)], // stocké dans l'autre sens
    ])
    expect(chains).toHaveLength(1)
    expect(chains[0][4]).toEqual(p(4))
  })

  it('peut inverser le premier membre grâce au voisin suivant', () => {
    const chains = chainSegments([
      [p(1), p(0)],
      [p(1), p(2)],
    ])
    expect(chains).toEqual([[p(0), p(1), p(2)]])
  })

  it('ne réordonne pas un membre situé plus loin dans la relation', () => {
    const far: LatLon = [45.5, 5.4]
    const chains = chainSegments([
      [p(0), p(1)],
      [far, [45.501, 5.4]],
      [p(1), p(2)],
    ])
    expect(chains).toHaveLength(3)
  })

  it('ne retourne jamais un membre dont la direction OSM est verrouillée', () => {
    const chains = chainSegments([
      [p(0), p(1)],
      [p(2), p(1)],
    ], [false, true])
    expect(chains).toHaveLength(2)
    expect(chains[1]).toEqual([p(2), p(1)])
  })

  it('laisse séparés des tronçons réellement disjoints (réseau points-nœuds)', () => {
    const far: LatLon = [45.5, 5.4] // ~25 km plus loin
    const chains = chainSegments([
      [p(0), p(1)],
      [far, [45.501, 5.4]],
    ])
    expect(chains).toHaveLength(2)
  })

  it('ne comble pas un trou cartographique de quelques mètres', () => {
    const gap: LatLon = [p(1)[0] + 0.00005, p(1)[1]] // environ 5,5 m
    const chains = chainSegments([[p(0), p(1)], [gap, p(2)]])
    expect(chains).toHaveLength(2)
  })

  it('ignore les segments dégénérés (moins de 2 points)', () => {
    expect(chainSegments([[p(0)], []])).toHaveLength(0)
  })
})

describe('buildGpx', () => {
  it('produit un GPX 1.1 avec trkseg par chaîne', () => {
    const gpx = buildGpx(
      'Boucle test',
      [[p(0), p(1)], [p(3), p(4)]],
      { relationId: 123, fetchedAt: Date.UTC(2026, 6, 19, 12, 0, 0) }
    )
    expect(gpx).toContain('<gpx version="1.1"')
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2)
    expect(gpx).toContain('lat="45.300000"')
    expect(gpx).toContain('2026-07-19T12:00:00.000Z')
    expect(gpx).toContain('https://www.openstreetmap.org/relation/123')
    expect(gpx.indexOf('<link href=')).toBeLessThan(gpx.indexOf('<time>'))
  })

  it('échappe le XML dans le nom (tag OSM non fiable)', () => {
    const gpx = buildGpx('<script>&"évil"</script>', [[p(0), p(1)]])
    expect(gpx).not.toContain('<script>')
    expect(gpx).toContain('&lt;script&gt;&amp;&quot;évil&quot;&lt;/script&gt;')
  })
})

describe('gpxFilename — slug sûr (writeFile recursive:true sans sanitisation)', () => {
  it('neutralise un tag OSM hostile de type path traversal', () => {
    expect(gpxFilename('../../evil', 'fallback')).toBe('evil.gpx')
  })

  it('slugifie accents et espaces', () => {
    expect(gpxFilename('Boucle équestre de Viriville', 'x')).toBe('Boucle-equestre-de-Viriville.gpx')
  })

  it('retombe sur le fallback si le nom est vide après nettoyage', () => {
    expect(gpxFilename('///…', 'circuit-42')).toBe('circuit-42.gpx')
  })
})

describe('polylineKm', () => {
  it('mesure ~0,4 km pour 5 points espacés de 100 m', () => {
    const km = polylineKm([p(0), p(1), p(2), p(3), p(4)])
    expect(km).toBeGreaterThan(0.35)
    expect(km).toBeLessThan(0.45)
  })
})
