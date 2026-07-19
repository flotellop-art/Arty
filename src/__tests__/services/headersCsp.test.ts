// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Garde anti-dérive sur public/_headers (leçon BUG 40/F-2 : ce fichier a déjà
// tué la géoloc de toute la PWA en silence, et BUG 62 : un fix non référencé
// donne l'illusion d'être réglé). Aucun autre test ne lisait ce fichier — si
// une ligne critique saute lors d'un futur nettoyage, la CI doit le voir.

const headers = readFileSync(resolve(__dirname, '../../../public/_headers'), 'utf8')
const cspLine = headers.split('\n').find((l) => l.includes('Content-Security-Policy')) ?? ''
const imgSrc = cspLine.split(';').find((d) => d.trim().startsWith('img-src')) ?? ''

describe('public/_headers — invariants CSP', () => {
  it('img-src autorise PLAN IGN et les 3 hôtes OpenTopoMap (page /trail/:id)', () => {
    for (const host of [
      'https://data.geopf.fr',
      'https://a.tile.opentopomap.org',
      'https://b.tile.opentopomap.org',
      'https://c.tile.opentopomap.org',
    ]) {
      expect(imgSrc, `hôte de tuiles manquant dans img-src : ${host}`).toContain(host)
    }
  })

  it("img-src n'utilise pas de wildcard pour les tuiles", () => {
    expect(imgSrc).not.toContain('*.tile.opentopomap.org')
  })

  it('connect-src autorise le pipeline sentiers direct (géocodeurs + Overpass)', () => {
    const connectSrc = cspLine.split(';').find((d) => d.trim().startsWith('connect-src')) ?? ''
    for (const host of [
      'https://overpass-api.de',
      'https://overpass.openstreetmap.fr',
      'https://api-adresse.data.gouv.fr',
      'https://geocoding-api.open-meteo.com',
      'https://nominatim.openstreetmap.org',
    ]) {
      expect(connectSrc, `host manquant dans connect-src : ${host}`).toContain(host)
    }
  })

  it('la géolocalisation reste autorisée pour la PWA (régression F-2)', () => {
    expect(headers).toContain('geolocation=(self)')
  })

  it("script-src reste sans 'unsafe-inline' (BUG 62)", () => {
    const scriptSrc = cspLine.split(';').find((d) => d.trim().startsWith('script-src')) ?? ''
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })
})
