import type { ToolHandler } from './types'
import { getUserLocation, isLocationConsentEnabled } from '../native/location'
import { markUntrustedThirdPartyData } from './untrustedContent'
import { buildGpx, chainSegments, gpxFilename, haversineMeters } from '../gpx'
import { downloadOrShareFile } from '../native/shareFile'
import { searchTrails, fetchTrailGeometries, fetchTrailGeometry, isTrailGeometry } from '../trailsClient'
import { createTrailSnapshotRefs, getCachedTrailGeometry, getTrailSnapshot, saveTrailGeometry } from '../trailSnapshots'
import { parseTrailSnapshotId } from '../reportActions'

const MAX_PRESENTED_TRAILS = 5

// ─────────────────────────────────────────────────────────────────────────────
// Outils sentiers/GPX (juillet 2026) — repousse la limite « Arty ne trouve pas
// de chemins de randonnée et ne sait pas produire une trace GPX ».
//
// find_trails passe par trailsClient (Overpass direct, serveur en repli) et
// renvoie au LLM un RÉSUMÉ texte, jamais la géométrie. Chaque résultat devient
// un snapshot IndexedDB local à id opaque. La page /trail/:trailId et l'export
// résolvent ce snapshot, puis conservent la même géométrie source localement :
// chat, carte et GPX ne peuvent plus dériver entre deux appels.
// Livraison GPX : share sheet natif (« Ouvrir avec Komoot… ») ou
// téléchargement web via downloadOrShareFile — PAS writeLocalFile (invisible
// sur Android 11+). Les tags OSM (name, description…) sont du contenu tiers
// éditable par n'importe qui → enveloppés markUntrustedThirdPartyData avant
// d'atteindre le modèle, et jamais utilisés bruts comme nom de fichier (slug
// gpxFilename).
// ─────────────────────────────────────────────────────────────────────────────

export const trailToolDefinitions = [
  {
    name: 'find_trails',
    description:
      "Cherche les circuits balisés (randonnée pédestre, équestre, VTT) autour d'un lieu dans OpenStreetMap : nom, type, portion repérée dans la zone, balisage et densité de chemins alentour. UTILISE CET OUTIL pour toute demande de sentiers, boucles de randonnée, itinéraires à cheval/VTT ou traces GPX — la recherche web ne donne pas accès à ces géodonnées. Si location est omis ET que la géolocalisation est active, utilise la position GPS de l'utilisateur.",
    input_schema: {
      type: 'object' as const,
      properties: {
        location: { type: 'string' as const, description: "Lieu de départ (village, adresse, ou coords « lat,lon »). Omis = position GPS de l'utilisateur si disponible." },
        radius_km: { type: 'number' as const, description: "Rayon géographique de recherche (1-15 km, défaut 10). Ce paramètre ne fixe PAS une longueur maximale de circuit : n'en déduis une que si l'utilisateur l'a explicitement demandée." },
        min_distance_km: { type: 'number' as const, description: "Longueur totale minimale du circuit, uniquement si l'utilisateur l'a demandée. Aucun minimum produit par défaut." },
        max_distance_km: { type: 'number' as const, description: "Longueur totale maximale du circuit, uniquement si l'utilisateur l'a demandée. Aucun maximum produit par défaut." },
        loop_only: { type: 'boolean' as const, description: "true uniquement si l'utilisateur demande explicitement une boucle revenant au départ ; sinon omettre." },
        kind: { type: 'string' as const, enum: ['horse', 'hiking', 'bike', 'all'], description: 'Type de circuit : horse (équestre), hiking (pédestre), bike (VTT/vélo), all (défaut).' },
      },
    },
  },
  {
    name: 'export_trail_gpx',
    description:
      "Génère le fichier GPX pleine résolution d'un circuit trouvé par find_trails et le propose à l'utilisateur (partage natif ou téléchargement). Appelle d'abord find_trails, puis passe ici le trail_id opaque du circuit choisi. Le GPX s'importe ensuite dans Komoot, VisuGPX, Organic Maps, etc. Pour VISUALISER le circuit dans Arty, ajoute plutôt un bouton view_trail dans ta réponse.",
    input_schema: {
      type: 'object' as const,
      properties: {
        trail_id: { type: 'string' as const, description: 'Référence opaque du circuit (champ trail_id renvoyé par find_trails).' },
      },
      required: ['trail_id'],
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

function optionalPositiveDistance(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
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

      const outcome = await searchTrails({
        location,
        radiusKm: input.radius_km,
        kind: input.kind,
      })
      if (!outcome.ok) {
        switch (outcome.status) {
          case 'network':
            return { result: 'Recherche de sentiers indisponible (réseau).' }
          case 'quota':
            return { result: 'Limite journalière de recherches de sentiers atteinte pour ce compte. Réessaie demain.' }
          case 'not_found':
            return { result: `Lieu "${location}" introuvable. Demande à l'utilisateur de préciser (commune + département).` }
          default:
            return { result: 'Recherche de sentiers momentanément indisponible. Réessaie dans quelques minutes.' }
        }
      }

      const data = outcome.data
      const routes = Array.isArray(data.routes) ? data.routes : []
      const centerLabel = data.center?.label || location
      const minDistanceKm = optionalPositiveDistance(input.min_distance_km)
      const maxDistanceKm = optionalPositiveDistance(input.max_distance_km)
      const loopOnly = input.loop_only === true
      if (minDistanceKm !== null && maxDistanceKm !== null && minDistanceKm > maxDistanceKm) {
        return { result: 'Le minimum demandé dépasse le maximum. Demande à l’utilisateur de préciser sa plage de distance.' }
      }
      const pathLine =
        `Réseau de chemins : ${data.nearbyPathCount ?? 0} chemins/pistes (track, path, bridleway) recensés dans un rayon de 3 km — ` +
        "ce compteur n'indique ni la surface, ni l'accès, ni la continuité d'une boucle."

      if (routes.length === 0) {
        return {
          result:
            `Aucun circuit balisé recensé sur OpenStreetMap à ${data.radiusKm ?? 10} km autour de ${centerLabel}.\n${pathLine}\n` +
            "Sois transparent avec l'utilisateur : pas de boucle officielle publiée dans cette zone. Propose d'élargir la zone de recherche ou un autre type (kind), sans inventer une longueur maximale de circuit.",
        }
      }

      // La longueur issue de la recherche est celle du tronçon dans la zone.
      // On charge donc les relations complètes AVANT de les recommander, dans
      // une seule requête groupée pour ménager les instances communautaires.
      const candidates = routes.filter((route) => maxDistanceKm === null || route.distanceKm <= maxDistanceKm)
      const cachedPairs = await Promise.all(candidates.map(async (route) => [route.id, await getCachedTrailGeometry(route.id)] as const))
      const cachedGeometries = cachedPairs.flatMap(([, geometry]) => geometry ? [geometry] : [])
      const missingIds = cachedPairs.filter(([, geometry]) => !geometry).map(([routeId]) => routeId)
      const geometryOutcome = missingIds.length > 0
        ? await fetchTrailGeometries(missingIds)
        : { ok: true as const, data: [] }
      if (!geometryOutcome.ok) {
        return {
          result: 'La recherche a trouvé des candidats, mais leur tracé complet ne peut pas être vérifié actuellement. Ne propose aucun tracé approximatif ; demande de réessayer plus tard.',
        }
      }
      const geometriesById = new Map(
        [...cachedGeometries, ...geometryOutcome.data]
          .filter(isTrailGeometry)
          .map((geometry) => [geometry.id, geometry] as const)
      )
      const verificationNote = geometriesById.size < candidates.length
        ? "Certains autres candidats n'ont pas été proposés car leur géométrie complète n'a pas pu être vérifiée."
        : ''
      const verified = candidates.flatMap((route) => {
        const geometry = geometriesById.get(route.id)
        if (!geometry || geometry.sourceSegments.length === 0) return []
        if (
          geometry.integrity?.hasNestedRelations || geometry.integrity?.displaySafe === false ||
          (geometry.integrity?.unsupportedWayRoles.length ?? 0) > 0
        ) return []
        const directionLocked = geometry.sourceSegmentDirectionLocked
        if (!Array.isArray(directionLocked) || directionLocked.length !== geometry.sourceSegments.length) return []
        const chains = chainSegments(geometry.sourceSegments, directionLocked)
        if (chains.length !== 1) return []
        const chain = chains[0]!
        if (loopOnly && haversineMeters(chain[0]!, chain[chain.length - 1]!) > 30) return []
        const totalMeters = geometry.distanceMeters ?? geometry.distanceKm * 1000
        if (minDistanceKm !== null && totalMeters < minDistanceKm * 1000) return []
        if (maxDistanceKm !== null && totalMeters > maxDistanceKm * 1000) return []
        return [{ route, geometry }]
      })
      if (verified.length === 0) {
        const constraint = [
          minDistanceKm !== null ? `au moins ${minDistanceKm} km` : null,
          maxDistanceKm !== null ? `au plus ${maxDistanceKm} km` : null,
        ].filter(Boolean).join(' et ')
        return {
          result:
            `Aucun circuit dont la géométrie complète est vérifiable${constraint ? ` (${constraint})` : ''} dans cette recherche.\n${pathLine}\n` +
            "Ne propose pas de tracé approximatif. Suggère d'élargir la zone ou de modifier les critères.",
        }
      }

      // Cinq réponses lisibles valent mieux que douze boutons qui gonflent le
      // contexte et évincent trop vite les références des conversations.
      const presented = verified.slice(0, MAX_PRESENTED_TRAILS)
      const snapshotResult = await createTrailSnapshotRefs(presented, {
        radiusKm: data.radiusKm ?? 10,
        center: data.center,
      })
      if (!snapshotResult.persistent) {
        return {
          result: "Les tracés ont été vérifiés, mais le stockage local durable de l'appareil est indisponible. Ne crée pas de bouton temporaire : demande de libérer de l'espace ou de réessayer.",
        }
      }
      const refs = snapshotResult.refs
      const lines = refs.map(({ route: r, trailId }, index) => {
        const geometry = presented[index]!.geometry
        const kindLabel = KIND_LABELS[r.kind] ?? r.kind
        const localScope = Math.abs(r.distanceKm - geometry.distanceKm) >= 0.1
          ? ` ; ${r.distanceKm} km dans la zone recherchée`
          : ''
        const scope = `${geometry.distanceKm} km calculés sur le tracé complet${localScope}`
        const extra = [r.colour ? `balisage ${r.colour}` : null, r.note].filter(Boolean).join(' · ')
        return `- trail_id ${trailId} — ${r.name} (${kindLabel}, ${scope})${extra ? ` — ${extra}` : ''}`
      })

      const summary = markUntrustedThirdPartyData(
        'OpenStreetMap',
        `Circuits balisés autour de ${centerLabel} (rayon ${data.radiusKm ?? 10} km) :\n${lines.join('\n')}\n${pathLine}${verificationNote ? `\n${verificationNote}` : ''}`
      )
      return {
        result:
          `${summary}\n\n` +
          'Pour chaque circuit pertinent, ajoute dans ta réponse un bouton carte : ' +
          '<button class="action-btn btn-primary" data-action="view_trail" data-trail-id="ID">🗺️ Voir la carte</button> ' +
          "(remplace ID par le trail_id opaque exact). L'utilisateur peut aussi demander le fichier GPX (export_trail_gpx). " +
          "La distance totale indiquée est calculée sur la géométrie OSM complète mise en cache pour la carte et le GPX ; elle ne certifie pas l'état réel du terrain. N'ajoute jamais un minimum ou maximum que l'utilisateur n'a pas demandé. Les segments de réseau local (points-nœuds) sont des tronçons à combiner, pas des boucles complètes ; ne promets jamais une « boucle » si la donnée ne le dit pas.",
      }
    },

    export_trail_gpx: async (input) => {
      const trailId = parseTrailSnapshotId(input.trail_id)
      if (!trailId) {
        return { result: 'trail_id invalide — utilise une référence renvoyée par find_trails.' }
      }
      const snapshot = await getTrailSnapshot(trailId)
      if (!snapshot) return { result: 'Cette référence locale a expiré — relance find_trails.' }

      let data = isTrailGeometry(snapshot.geometry) ? snapshot.geometry : undefined
      if (!data) {
        const outcome = await fetchTrailGeometry(snapshot.routeId)
        if (!outcome.ok) {
          switch (outcome.status) {
            case 'network':
              return { result: 'Export GPX indisponible (réseau).' }
            case 'quota':
              return { result: 'Limite journalière atteinte pour ce compte. Réessaie demain.' }
            case 'not_found':
              return { result: 'Circuit introuvable — relance find_trails pour obtenir une référence à jour.' }
            default:
              return { result: 'Export GPX momentanément indisponible. Réessaie dans quelques minutes.' }
          }
        }
        data = outcome.data
        await saveTrailGeometry(trailId, data)
      }

      const segments = Array.isArray(data.sourceSegments) ? data.sourceSegments : []
      if (segments.length === 0) {
        return { result: 'Pas de géométrie exploitable pour ce circuit.' }
      }

      const name = typeof data.name === 'string' && data.name ? data.name : `circuit-${snapshot.routeId}`
      const filename = gpxFilename(name, `circuit-${snapshot.routeId}`)
      // Seules les extrémités identiques à 1 m près sont raccordées. Toute
      // vraie discontinuité OSM reste un <trkseg>, sans diagonale inventée.
      const directionLocked = data.sourceSegmentDirectionLocked
      if (!Array.isArray(directionLocked) || directionLocked.length !== segments.length) {
        return { result: 'La direction des tronçons de ce circuit ne peut pas être vérifiée. Relance la recherche avant tout export GPX.' }
      }
      const chains = chainSegments(segments, directionLocked)
      const gpx = buildGpx(name, chains, {
        relationId: data.provenance.relationId,
        fetchedAt: data.provenance.fetchedAt,
      })

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
            ? 'Plusieurs segments = fragments OSM conservés sans raccord artificiel ; préviens que la continuité doit être vérifiée.'
            : 'Trace continue dans la géométrie OSM.'),
      }
    },
  }
}
