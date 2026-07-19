import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchTrailGeometry, type TrailGeometry } from '../services/trailsClient'
import { parseTrailRouteId } from '../services/reportActions'
import { buildGpx, chainSegments, gpxFilename, type LatLon } from '../services/gpx'
import { downloadOrShareFile } from '../services/native/shareFile'
import { getUserLocation } from '../services/native/location'

// ─────────────────────────────────────────────────────────────────────────────
// Page /trail/:routeId — visualiseur de sentier in-app (juillet 2026).
//
// Design issu de la synthèse multi-IA validée par Florent : PAGE dédiée (pas
// de modal — survit au process kill Android, navigable), Leaflet en chunk
// lazy (ce module n'est importé que par la route, cf. App.tsx), fond
// OpenTopoMap avec MODE DÉGRADÉ tracé-seul de première classe (tuiles KO →
// le tracé, la distance et le GPX restent utilisables), position GPS à la
// demande uniquement (pas de watch — batterie), export GPX conservé comme
// filet terrain. BUG 61 : aucun état stable ne rend un écran vide — chaque
// échec a un message et une action.
//
// Le nom du circuit vient d'OSM (contenu tiers) : rendu en texte React
// (échappé par construction), jamais en HTML. Le marqueur GPS est un DivIcon
// CSS — L.Icon.Default casse avec Vite (chemins d'assets, bug Leaflet connu).
// ─────────────────────────────────────────────────────────────────────────────

const TILE_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; trail: TrailGeometry; chains: LatLon[][] }
  | { kind: 'notfound' }
  | { kind: 'quota' }
  | { kind: 'error' }

const KIND_KEYS: Record<string, string> = {
  horse: 'trailPage.kindHorse',
  hiking: 'trailPage.kindHiking',
  foot: 'trailPage.kindHiking',
  bicycle: 'trailPage.kindBike',
  mtb: 'trailPage.kindBike',
}

export function TrailScreen() {
  const { routeId: rawRouteId } = useParams<{ routeId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const routeId = parseTrailRouteId(rawRouteId ?? '')

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [tilesDown, setTilesDown] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const gpsMarkerRef = useRef<L.Marker | null>(null)

  const goBack = useCallback(() => {
    // Entrée directe (deep link / refresh) : pas d'historique → retour Home
    // en replace, jamais de sortie d'app surprise.
    if (window.history.length > 1) navigate(-1)
    else navigate('/', { replace: true })
  }, [navigate])

  const load = useCallback(async () => {
    if (routeId === null) {
      setState({ kind: 'notfound' })
      return
    }
    setState({ kind: 'loading' })
    const outcome = await fetchTrailGeometry(routeId)
    if (!outcome.ok) {
      setState({
        kind: outcome.status === 'quota' ? 'quota' : outcome.status === 'not_found' ? 'notfound' : 'error',
      })
      return
    }
    const segments = Array.isArray(outcome.data.segments) ? outcome.data.segments : []
    const chains = chainSegments(segments)
    if (chains.length === 0) {
      setState({ kind: 'notfound' })
      return
    }
    setState({ kind: 'ready', trail: outcome.data, chains })
  }, [routeId])

  useEffect(() => {
    void load()
  }, [load])

  // Monte la carte quand la géométrie est prête. Recréée si le tracé change.
  useEffect(() => {
    if (state.kind !== 'ready' || !mapContainerRef.current) return

    const map = L.map(mapContainerRef.current, { zoomControl: true })
    mapRef.current = map

    const tiles = L.tileLayer(TILE_URL, {
      subdomains: 'abc',
      maxZoom: 17,
      attribution: TILE_ATTRIBUTION,
    })
    // Mode dégradé : tuiles KO avant le premier chargement réussi → bandeau,
    // le tracé reste affiché sur fond neutre. Un chargement réussi le retire.
    let anyTileLoaded = false
    tiles.on('tileerror', () => setTilesDown((down) => down || !anyTileLoaded))
    tiles.on('tileload', () => {
      anyTileLoaded = true
      setTilesDown(false)
    })
    tiles.addTo(map)

    const allPoints: L.LatLngExpression[] = []
    for (const chain of state.chains) {
      L.polyline(chain, { color: '#ea580c', weight: 4, opacity: 0.9 }).addTo(map)
      allPoints.push(...chain)
    }
    const start = state.chains[0]?.[0]
    if (start) {
      L.marker(start, {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:14px;height:14px;border-radius:50%;background:#16a34a;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(map)
    }
    if (allPoints.length > 0) {
      map.fitBounds(L.latLngBounds(allPoints as L.LatLng[]), { padding: [32, 32] })
    }

    // Leaflet mesure son conteneur au moment du L.map() — si le layout n'est
    // pas encore stabilisé (montage de page, rotation), la grille de tuiles
    // est fausse. invalidateSize après le prochain frame ET après 300 ms.
    const raf = requestAnimationFrame(() => map.invalidateSize())
    const timer = window.setTimeout(() => map.invalidateSize(), 300)
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
      gpsMarkerRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [state])

  // Position GPS À LA DEMANDE uniquement (un fix par clic — pas de watch,
  // décision batterie assumée). Le service location.ts gère consent + BUG 55.
  const locateMe = useCallback(async () => {
    if (locating) return
    setLocating(true)
    setLocationError(false)
    try {
      const pos = await getUserLocation({ forceFresh: true })
      const map = mapRef.current
      if (!pos || !map) {
        setLocationError(true)
        return
      }
      const latLng: LatLon = [pos.latitude, pos.longitude]
      if (gpsMarkerRef.current) {
        gpsMarkerRef.current.setLatLng(latLng)
      } else {
        gpsMarkerRef.current = L.marker(latLng, {
          icon: L.divIcon({
            className: '',
            html: '<div style="width:16px;height:16px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.25)"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        }).addTo(map)
      }
      map.panTo(latLng)
    } finally {
      setLocating(false)
    }
  }, [locating])

  const downloadGpx = useCallback(async () => {
    if (state.kind !== 'ready') return
    const name = state.trail.name || `circuit-${state.trail.id}`
    const gpx = buildGpx(name, state.chains)
    try {
      await downloadOrShareFile(
        new Blob([gpx], { type: 'application/gpx+xml' }),
        gpxFilename(name, `circuit-${state.trail.id}`),
        { title: t('trailPage.shareTitle'), dialogTitle: t('trailPage.shareTitle') }
      )
    } catch {
      // Share sheet fermé sans choisir — pas une erreur.
    }
  }, [state, t])

  if (state.kind !== 'ready') {
    const message =
      state.kind === 'loading' ? t('trailPage.loading')
      : state.kind === 'notfound' ? t('trailPage.notFound')
      : state.kind === 'quota' ? t('trailPage.quota')
      : t('trailPage.error')
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-[100dvh] bg-theme-bg px-6 text-center">
        <p className="text-theme-muted">{message}</p>
        {state.kind === 'notfound' && (
          <p className="text-sm text-theme-muted">{t('trailPage.notFoundHint')}</p>
        )}
        <div className="flex gap-2">
          {state.kind === 'error' && (
            <button
              type="button"
              onClick={() => { void load() }}
              className="rounded-md bg-theme-accent px-4 py-2 text-sm font-semibold text-white shadow-sm"
            >
              {t('trailPage.retry')}
            </button>
          )}
          <button
            type="button"
            onClick={goBack}
            className="rounded-md bg-theme-ink px-4 py-2 text-sm font-semibold text-theme-bg shadow-sm"
          >
            {t('trailPage.back')}
          </button>
        </div>
      </div>
    )
  }

  const kindKey = KIND_KEYS[state.trail.kind]
  return (
    <div className="flex flex-col h-[100dvh] bg-theme-bg">
      <header
        className="flex items-center gap-3 px-3 pb-2 border-b border-theme-ink/10"
        style={{ paddingTop: 'max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))' }}
      >
        <button
          type="button"
          onClick={goBack}
          className="shrink-0 rounded-md bg-theme-ink px-3 py-2 text-[11px] font-semibold text-theme-bg shadow-sm"
        >
          {t('trailPage.back')}
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-theme-ink">{state.trail.name}</h1>
          <p className="text-xs text-theme-muted">
            {state.trail.distanceKm} km
            {kindKey ? ` · ${t(kindKey)}` : ''}
            {state.chains.length > 1 ? ` · ${t('trailPage.segments', { count: state.chains.length })}` : ''}
          </p>
        </div>
      </header>

      {tilesDown && (
        <div className="bg-amber-100 px-3 py-1.5 text-center text-xs text-amber-900">
          {t('trailPage.tilesDown')}
        </div>
      )}
      {locationError && (
        <div className="bg-theme-ink/5 px-3 py-1.5 text-center text-xs text-theme-muted">
          {t('trailPage.locationUnavailable')}
        </div>
      )}

      {/* Fond neutre : si les tuiles ne chargent pas, le tracé reste lisible. */}
      <div ref={mapContainerRef} className="flex-1" style={{ background: '#e7e5e4' }} />

      <footer
        className="flex gap-2 border-t border-theme-ink/10 px-3 pt-2"
        style={{ paddingBottom: 'max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem))' }}
      >
        <button
          type="button"
          onClick={() => { void locateMe() }}
          disabled={locating}
          className="flex-1 rounded-md bg-theme-ink px-4 py-2.5 text-sm font-semibold text-theme-bg shadow-sm disabled:opacity-60"
        >
          {locating ? t('trailPage.locating') : t('trailPage.locate')}
        </button>
        <button
          type="button"
          onClick={() => { void downloadGpx() }}
          className="flex-1 rounded-md bg-theme-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
        >
          {t('trailPage.downloadGpx')}
        </button>
      </footer>
    </div>
  )
}
