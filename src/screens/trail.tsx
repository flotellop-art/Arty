import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchTrailGeometry, isTrailGeometry, type TrailGeometry } from '../services/trailsClient'
import { parseTrailSnapshotId } from '../services/reportActions'
import { buildGpx, chainSegments, gpxFilename, haversineMeters, type LatLon } from '../services/gpx'
import { downloadOrShareFile } from '../services/native/shareFile'
import { getUserLocation, isLocationConsentEnabled, requestLocationPermission } from '../services/native/location'
import { getTrailSnapshot, saveTrailGeometry, type TrailSnapshot } from '../services/trailSnapshots'

// Visualiseur zéro coût : PLAN IGN v2 (France) en fond principal,
// OpenTopoMap en comparaison et grille neutre en mode dégradé. La carte
// consomme uniquement la géométrie d'affichage ; distance et GPX proviennent
// toujours de la source pleine résolution conservée dans le snapshot local.

const IGN_TILE_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
const IGN_ATTRIBUTION =
  '© <a href="https://www.ign.fr/">IGN</a> · <a href="https://cartes.gouv.fr/">Géoplateforme</a>'
const TOPO_TILE_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
const TOPO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · © <a href="https://opentopomap.org">OpenTopoMap</a>'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; trail: TrailGeometry; snapshot: TrailSnapshot }
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
  const { trailId: rawTrailId } = useParams<{ trailId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const trailId = parseTrailSnapshotId(rawTrailId ?? '')

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [tilesDown, setTilesDown] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState(false)
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const routeBoundsRef = useRef<L.LatLngBounds | null>(null)
  const fullRouteBoundsRef = useRef<L.LatLngBounds | null>(null)
  const gpsMarkerRef = useRef<L.Marker | null>(null)
  const gpsAccuracyRef = useRef<L.Circle | null>(null)

  const goBack = useCallback(() => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/', { replace: true })
  }, [navigate])

  const load = useCallback(async () => {
    if (!trailId) {
      setState({ kind: 'notfound' })
      return
    }
    setState({ kind: 'loading' })
    const snapshot = await getTrailSnapshot(trailId)
    if (!snapshot) {
      setState({ kind: 'notfound' })
      return
    }

    let geometry = isTrailGeometry(snapshot.geometry) ? snapshot.geometry : undefined
    if (!geometry) {
      const outcome = await fetchTrailGeometry(snapshot.routeId)
      if (!outcome.ok) {
        setState({
          kind: outcome.status === 'quota' ? 'quota' : outcome.status === 'not_found' ? 'notfound' : 'error',
        })
        return
      }
      geometry = outcome.data
      await saveTrailGeometry(trailId, geometry)
    }

    const sourceSegments = Array.isArray(geometry.sourceSegments) ? geometry.sourceSegments : []
    const displaySegments = Array.isArray(geometry.displaySegments) ? geometry.displaySegments : []
    if (
      sourceSegments.length === 0 || displaySegments.length === 0 || geometry.integrity?.displaySafe === false ||
      !Array.isArray(geometry.sourceSegmentDirectionLocked) ||
      geometry.sourceSegmentDirectionLocked.length !== sourceSegments.length
    ) {
      setState({ kind: 'notfound' })
      return
    }
    setState({ kind: 'ready', trail: geometry, snapshot: { ...snapshot, geometry } })
  }, [trailId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (state.kind !== 'ready' || !mapContainerRef.current) return

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      preferCanvas: true,
      zoomSnap: 0.5,
    })
    mapRef.current = map

    const planIgn = L.tileLayer(IGN_TILE_URL, {
      maxNativeZoom: 19,
      maxZoom: 19,
      attribution: IGN_ATTRIBUTION,
    })
    const openTopo = L.tileLayer(TOPO_TILE_URL, {
      subdomains: 'abc',
      maxNativeZoom: 17,
      maxZoom: 19,
      attribution: TOPO_ATTRIBUTION,
    })

    const onTileError = () => setTilesDown(true)
    const onTileSuccess = () => {
      if (navigator.onLine) setTilesDown(false)
    }
    for (const layer of [planIgn, openTopo]) {
      layer.on('tileerror', onTileError)
      // `load` signifie seulement « toutes les tuiles ont terminé », erreurs
      // comprises. Seul `tileload` prouve qu'un fond a réellement été reçu.
      layer.on('tileload', onTileSuccess)
    }
    planIgn.addTo(map)
    L.control.layers(
      { [t('trailPage.layerIgn')]: planIgn, [t('trailPage.layerTopo')]: openTopo },
      undefined,
      { position: 'topright' }
    ).addTo(map)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)

    // Deux multi-polylignes au total (halo + cœur), quelle que soit la quantité
    // de ways OSM. Créer deux layers PAR way saturait les appareils modestes.
    L.polyline(state.trail.displaySegments, {
      color: '#ffffff', weight: 9, opacity: 0.94, interactive: false, smoothFactor: 0,
    }).addTo(map)
    L.polyline(state.trail.displaySegments, {
      color: '#2563eb', weight: 5, opacity: 1, interactive: false, smoothFactor: 0,
    }).addTo(map)
    const allPoints = state.trail.displaySegments.flat()
    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints)
      fullRouteBoundsRef.current = bounds
      const center = state.snapshot.nearbyCenter
      // Le cadrage utilise la source pleine résolution : la simplification
      // d'affichage peut supprimer tous les nœuds intérieurs d'un long way.
      const sourcePoints = state.trail.sourceSegments.flat()
      const localRadiusKm = state.snapshot.radiusKm
      const localPoints = center
        ? sourcePoints.filter((point) => haversineMeters(point, [center.lat, center.lon]) <= localRadiusKm * 1000)
        : []
      const localBounds = localPoints.length >= 2
        ? L.latLngBounds(localPoints)
        : center
          ? (() => {
              const latPad = localRadiusKm / 111.32
              const lonPad = latPad / Math.max(0.2, Math.cos(center.lat * Math.PI / 180))
              return L.latLngBounds(
                [center.lat - latPad, center.lon - lonPad],
                [center.lat + latPad, center.lon + lonPad]
              )
            })()
          : null
      const localDiffers = Math.abs(state.snapshot.distanceInAreaKm - state.trail.distanceKm) >= 0.1
      routeBoundsRef.current = localDiffers && localBounds ? localBounds : bounds
      map.fitBounds(routeBoundsRef.current, { padding: [36, 36], maxZoom: 17 })
    }

    const onOffline = () => setTilesDown(true)
    const onOnline = () => {
      // Garder le bandeau jusqu'à la première vraie tuile reçue.
      setTilesDown(true)
      planIgn.redraw()
      openTopo.redraw()
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)

    const raf = requestAnimationFrame(() => map.invalidateSize())
    const timer = window.setTimeout(() => map.invalidateSize(), 300)
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      gpsMarkerRef.current = null
      gpsAccuracyRef.current = null
      routeBoundsRef.current = null
      fullRouteBoundsRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [state, t])

  const recenterTrail = useCallback(() => {
    const map = mapRef.current
    const bounds = routeBoundsRef.current
    if (map && bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 })
  }, [])

  const showFullTrail = useCallback(() => {
    const map = mapRef.current
    const bounds = fullRouteBoundsRef.current
    if (map && bounds) map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 })
  }, [])

  const locateMe = useCallback(async () => {
    if (locating) return
    setLocating(true)
    setLocationError(false)
    try {
      if (!isLocationConsentEnabled() || !await requestLocationPermission()) {
        setLocationError(true)
        return
      }
      const pos = await getUserLocation({ forceFresh: true })
      const map = mapRef.current
      if (!pos || !map) {
        setLocationError(true)
        return
      }
      const latLng: LatLon = [pos.latitude, pos.longitude]
      if (gpsMarkerRef.current) gpsMarkerRef.current.setLatLng(latLng)
      else {
        gpsMarkerRef.current = L.marker(latLng, {
          icon: L.divIcon({
            className: '',
            html: '<div class="arty-gps-dot"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
        }).addTo(map)
      }
      if (gpsAccuracyRef.current) {
        gpsAccuracyRef.current.setLatLng(latLng).setRadius(pos.accuracy)
      } else {
        gpsAccuracyRef.current = L.circle(latLng, {
          radius: pos.accuracy,
          color: '#2563eb',
          weight: 1,
          fillColor: '#60a5fa',
          fillOpacity: 0.15,
          interactive: false,
        }).addTo(map)
      }
      setGpsAccuracy(Math.round(pos.accuracy))
      map.flyTo(latLng, Math.max(map.getZoom(), 16), { duration: 0.45 })
    } catch {
      setLocationError(true)
    } finally {
      setLocating(false)
    }
  }, [locating])

  const downloadGpx = useCallback(async () => {
    if (state.kind !== 'ready') return
    const name = state.trail.name || `circuit-${state.trail.id}`
    const gpx = buildGpx(
      name,
      chainSegments(state.trail.sourceSegments, state.trail.sourceSegmentDirectionLocked),
      {
        relationId: state.trail.provenance.relationId,
        fetchedAt: state.trail.provenance.fetchedAt,
      }
    )
    try {
      await downloadOrShareFile(
        new Blob([gpx], { type: 'application/gpx+xml' }),
        gpxFilename(name, `circuit-${state.trail.id}`),
        { title: t('trailPage.shareTitle'), dialogTitle: t('trailPage.shareTitle') }
      )
    } catch {
      // Fermer le share sheet n'altère ni le snapshot ni la trace locale.
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
        {state.kind === 'notfound' && <p className="text-sm text-theme-muted">{t('trailPage.notFoundHint')}</p>}
        <div className="flex gap-2">
          {state.kind === 'error' && (
            <button type="button" onClick={() => { void load() }} className="min-h-11 rounded-md bg-theme-accent px-4 py-2 text-sm font-semibold text-white shadow-sm">
              {t('trailPage.retry')}
            </button>
          )}
          <button type="button" onClick={goBack} className="min-h-11 rounded-md bg-theme-ink px-4 py-2 text-sm font-semibold text-theme-bg shadow-sm">
            {t('trailPage.back')}
          </button>
        </div>
      </div>
    )
  }

  const kindKey = KIND_KEYS[state.trail.kind]
  const localDiffers = Math.abs(state.snapshot.distanceInAreaKm - state.trail.distanceKm) >= 0.1
  return (
    <div className="flex flex-col h-[100dvh] bg-theme-bg">
      <header className="flex items-center gap-3 px-3 pb-2 border-b border-theme-ink/10" style={{ paddingTop: 'max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.5rem))' }}>
        <button type="button" onClick={goBack} aria-label={t('trailPage.back')} className="min-h-11 shrink-0 rounded-md bg-theme-ink px-3 py-2 text-xs font-semibold text-theme-bg shadow-sm">
          {t('trailPage.back')}
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-theme-ink">{state.trail.name}</h1>
          <p className="text-sm font-semibold text-theme-ink">{t('trailPage.totalDistance', { distance: state.trail.distanceKm })}</p>
          <p className="text-xs text-theme-muted">
            {localDiffers ? `${t('trailPage.areaDistance', { distance: state.snapshot.distanceInAreaKm })} · ` : ''}
            {kindKey ? t(kindKey) : state.trail.kind}
          </p>
        </div>
      </header>

      {tilesDown && <div role="status" aria-live="polite" className="bg-amber-100 px-3 py-1.5 text-center text-xs text-amber-900">{t('trailPage.tilesDown')}</div>}
      {locationError && <div role="status" aria-live="polite" className="bg-theme-ink/5 px-3 py-1.5 text-center text-xs text-theme-muted">{t('trailPage.locationUnavailable')}</div>}
      {gpsAccuracy !== null && !locationError && <div role="status" aria-live="polite" className="bg-blue-50 px-3 py-1 text-center text-xs text-blue-900">{t('trailPage.gpsAccuracy', { accuracy: gpsAccuracy })}</div>}

      <div className="relative flex-1 min-h-0">
        <div
          ref={mapContainerRef}
          className="h-full w-full arty-trail-map"
          role="region"
          aria-label={t('trailPage.mapAria', { name: state.trail.name })}
          style={{
            backgroundColor: '#e7e5e4',
            backgroundImage: 'linear-gradient(rgba(120,113,108,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(120,113,108,.12) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="absolute bottom-4 right-3 z-[500] flex flex-col gap-2">
          {localDiffers && (
            <button type="button" onClick={showFullTrail} className="min-h-12 rounded-lg border border-white/80 bg-white px-3 text-sm font-semibold text-stone-900 shadow-lg" aria-label={t('trailPage.showFull')}>
              ⛶ {t('trailPage.showFull')}
            </button>
          )}
          <button type="button" onClick={recenterTrail} className="min-h-12 rounded-lg border border-white/80 bg-white px-3 text-sm font-semibold text-stone-900 shadow-lg" aria-label={t(localDiffers ? 'trailPage.searchArea' : 'trailPage.recenter')}>
            ↗ {t(localDiffers ? 'trailPage.searchArea' : 'trailPage.recenter')}
          </button>
        </div>
      </div>

      <footer className="flex gap-2 border-t border-theme-ink/10 px-3 pt-2" style={{ paddingBottom: 'max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem))' }}>
        <button type="button" onClick={() => { void locateMe() }} disabled={locating} className="min-h-12 flex-1 rounded-md bg-theme-ink px-3 py-2.5 text-sm font-semibold text-theme-bg shadow-sm disabled:opacity-60">
          {locating ? t('trailPage.locating') : t('trailPage.locate')}
        </button>
        <button type="button" onClick={() => { void downloadGpx() }} className="min-h-12 flex-1 rounded-md bg-theme-accent px-3 py-2.5 text-sm font-semibold text-white shadow-sm">
          {t('trailPage.downloadGpx')}
        </button>
      </footer>
    </div>
  )
}
