import type { ToolHandler } from './types'
import { apiUrl } from '../apiBase'
import { safeJson } from '../../utils/safeJson'
import { getValidAccessToken } from '../googleAuth'
import { getUserLocation, isLocationConsentEnabled } from '../native/location'
import { markUntrustedThirdPartyData } from './untrustedContent'
import { buildGpx, chainSegments, gpxFilename, type LatLon } from '../gpx'
import { downloadOrShareFile } from '../native/shareFile'

// ─────────────────────────────────────────────────────────────────────────────
// Outils sentiers/GPX (juillet 2026) — repousse la limite « Arty ne trouve pas
// de chemins de randonnée et ne sait pas produire une trace GPX ».
//
// find_trails interroge /api/geo/trails (Overpass/OSM côté serveur) et renvoie
// au LLM un RÉSUMÉ texte (jamais la géométrie : inutile au modèle et ruineuse
// en tokens). export_trail_gpx re-résout la géométrie par id OSM via le même
// endpoint (cache serveur 24 h) puis génère le fichier côté client — stateless,
// pas de cache module partagé entre conversations (revue agents, RÈGLE 7).
// Livraison : share sheet natif (« Ouvrir avec Komoot… ») ou téléchargement web
// via downloadOrShareFile — PAS writeLocalFile (invisible sur Android 11+).
// Les tags OSM (name, description…) sont du contenu tiers éditable par
// n'importe qui → enveloppés markUntrustedThirdPartyData avant d'atteindre le
// modèle, et jamais utilisés bruts comme nom de fichier (slug gpxFilename).
// ─────────────────────────────────────────────────────────────────────────────

export const trailToolDefinitions = [
  {
    name: 'find_trails',
    description:
      "Cherche les circuits balisés (randonnée pédestre, équestre, VTT) autour d'un lieu dans OpenStreetMap : nom, type, longueur réelle, balisage, et densité de chemins de terre alentour. UTILISE CET OUTIL pour toute demande de sentiers, boucles de randonnée, itinéraires à cheval/VTT ou traces GPX — la recherche web ne donne pas accès à ces géodonnées. Si location est omis ET que la géolocalisation est active, utilise la position GPS de l'utilisateur.",
    input_schema: {
      type: 'object' as const,
      properties: {
        location: { type: 'string' as const, description: "Lieu de départ (village, adresse, ou coords « lat,lon »). Omis = position GPS de l'utilisateur si disponible." },
        radius_km: { type: 'number' as const, description: 'Rayon de recherche en km (1-15, défaut 6).' },
        kind: { type: 'string' as const, enum: ['horse', 'hiking', 'bike', 'all'], description: 'Type de circuit : horse (équestre), hiking (pédestre), bike (VTT/vélo), all (défaut).' },
      },
    },
  },
  {
    name: 'export_trail_gpx',
    description:
      "Génère le fichier GPX d'un circuit trouvé par find_trails et le propose à l'utilisateur (partage natif ou téléchargement). Appelle d'abord find_trails, puis passe ici le route_id du circuit choisi. Le GPX s'importe ensuite dans Komoot, VisuGPX, Organic Maps, etc.",
    input_schema: {
      type: 'object' as const,
      properties: {
        route_id: { type: 'number' as const, description: 'Id OSM du circuit (champ id renvoyé par find_trails).' },
      },
      required: ['route_id'],
    },
  },
]

const KIND_LABELS: Record<string, string> = {
  horse: 'équestre',
  hiking: 'pédestre',
  foot: 'pédestre',
  bicycle: 'vélo',
  mtb: 'VTT',
}

interface TrailRoute {
  id: number
  name: string
  kind: string
  network: string | null
  longDistance: boolean
  distanceKm: number
  colour: string | null
  note: string | null
}

async function callTrailsApi(body: Record<string, unknown>): Promise<Response | null> {
  // BUG 23 : toujours getValidAccessToken() (refresh auto), jamais le token brut.
  const googleToken = await getValidAccessToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (googleToken) headers['x-google-token'] = googleToken

  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'AbortError')), 30_000)
  try {
    return await fetch(apiUrl('/api/geo/trails'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

export function createTrailHandlers(): Record<string, ToolHandler> {
  return {
    find_trails: async (input) => {
      let location = (input.location as string | undefined)?.trim() || ''
      if (!location && isLocationConsentEnabled()) {
        const pos = await getUserLocation()
        if (pos) location = `${pos.latitude.toFixed(5)},${pos.longitude.toFixed(5)}`
      }
      if (!location) {
        return { result: "Précise un lieu de départ (village, adresse). La géolocalisation n'est pas activée." }
      }

      const res = await callTrailsApi({
        action: 'search',
        location,
        radiusKm: input.radius_km,
        kind: input.kind,
      })
      if (!res) return { result: 'Recherche de sentiers indisponible (réseau).' }
      if (res.status === 429) {
        return { result: 'Limite journalière de recherches de sentiers atteinte pour ce compte. Réessaie demain.' }
      }
      if (res.status === 404) {
        return { result: `Lieu "${location}" introuvable. Demande à l'utilisateur de préciser (commune + département).` }
      }
      if (!res.ok) {
        return { result: 'Recherche de sentiers momentanément indisponible. Réessaie dans quelques minutes.' }
      }

      const data = await safeJson(res) as {
        center?: { label?: string }
        radiusKm?: number
        routes?: TrailRoute[]
        nearbyPathCount?: number
      }
      const routes = Array.isArray(data.routes) ? data.routes : []
      const centerLabel = data.center?.label || location
      const pathLine =
        `Réseau de chemins : ${data.nearbyPathCount ?? 0} chemins/pistes (track, path, bridleway) recensés dans un rayon de 3 km — ` +
        'utile pour improviser des boucles en terrain souple.'

      if (routes.length === 0) {
        return {
          result:
            `Aucun circuit balisé recensé sur OpenStreetMap à ${data.radiusKm ?? 6} km autour de ${centerLabel}.\n${pathLine}\n` +
            "Sois transparent avec l'utilisateur : pas de boucle officielle publiée dans ce rayon. Propose d'élargir le rayon (radius_km jusqu'à 15) ou un autre type (kind).",
        }
      }

      const lines = routes.map((r) => {
        const kindLabel = KIND_LABELS[r.kind] ?? r.kind
        const scope = r.longDistance
          ? `itinéraire longue distance — tronçon de ${r.distanceKm} km dans la zone`
          : `${r.distanceKm} km`
        const extra = [r.colour ? `balisage ${r.colour}` : null, r.note].filter(Boolean).join(' · ')
        return `- id ${r.id} — ${r.name} (${kindLabel}, ${scope})${extra ? ` — ${extra}` : ''}`
      })

      const summary = markUntrustedThirdPartyData(
        'OpenStreetMap',
        `Circuits balisés autour de ${centerLabel} (rayon ${data.radiusKm ?? 6} km) :\n${lines.join('\n')}\n${pathLine}`
      )
      return {
        result:
          `${summary}\n\n` +
          'Pour livrer une trace : appelle export_trail_gpx avec le route_id choisi. ' +
          "Présente honnêtement les résultats : les segments de réseau local (points-nœuds) sont des tronçons à combiner, pas des boucles complètes ; ne promets jamais une « boucle » si la donnée ne le dit pas.",
      }
    },

    export_trail_gpx: async (input) => {
      const routeId = Number(input.route_id)
      if (!Number.isInteger(routeId) || routeId <= 0) {
        return { result: 'route_id invalide — utilise un id renvoyé par find_trails.' }
      }

      const res = await callTrailsApi({ action: 'geometry', routeId })
      if (!res) return { result: 'Export GPX indisponible (réseau).' }
      if (res.status === 429) {
        return { result: 'Limite journalière atteinte pour ce compte. Réessaie demain.' }
      }
      if (!res.ok) {
        return { result: `Circuit ${routeId} introuvable — relance find_trails pour obtenir des ids à jour.` }
      }

      const data = await safeJson(res) as {
        name?: string
        distanceKm?: number
        segments?: LatLon[][]
      }
      const segments = Array.isArray(data.segments) ? data.segments : []
      if (segments.length === 0) {
        return { result: `Pas de géométrie exploitable pour le circuit ${routeId}.` }
      }

      const chains = chainSegments(segments)
      const name = typeof data.name === 'string' && data.name ? data.name : `circuit-${routeId}`
      const filename = gpxFilename(name, `circuit-${routeId}`)
      const gpx = buildGpx(name, chains)

      try {
        await downloadOrShareFile(new Blob([gpx], { type: 'application/gpx+xml' }), filename, {
          title: filename,
          text: 'Trace GPX générée par Arty',
          dialogTitle: 'Partager la trace GPX',
        })
      } catch {
        // Sur natif, fermer le share sheet sans choisir rejette la promesse —
        // le fichier a bien été généré, ne pas le présenter comme un échec dur.
        return {
          result: `Trace GPX ${filename} générée (${data.distanceKm ?? '?'} km) mais le partage a été annulé. L'utilisateur peut relancer export_trail_gpx.`,
        }
      }

      // BUG 11-adjacent : ne JAMAIS renvoyer le XML complet dans result (il
      // serait persisté dans la conversation) — un résumé suffit au modèle.
      return {
        result:
          `Trace GPX ${filename} livrée à l'utilisateur (${data.distanceKm ?? '?'} km, ` +
          `${chains.length} segment${chains.length > 1 ? 's' : ''} continu${chains.length > 1 ? 's' : ''}). ` +
          (chains.length > 1
            ? 'Plusieurs segments = tronçons disjoints dans OSM : préviens que la trace n\'est pas une boucle continue.'
            : 'Trace continue.'),
      }
    },
  }
}
