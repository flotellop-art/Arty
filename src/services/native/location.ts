import { Geolocation } from '@capacitor/geolocation'
import { isNative } from './platform'
import * as scoped from '../scopedStorage'

export interface UserLocation {
  latitude: number
  longitude: number
  accuracy: number
  capturedAt: number
}

const CONSENT_KEY = 'location-consent'
const CACHE_TTL_MS = 5 * 60 * 1000
const WATCH_TIMEOUT_MS = 10000
const GOOD_ACCURACY_M = 50

let cached: UserLocation | null = null

export function isLocationConsentEnabled(): boolean {
  const stored = scoped.getJSON<boolean>(CONSENT_KEY)
  return stored === null ? true : stored === true
}

export function setLocationConsent(enabled: boolean): void {
  scoped.setJSON(CONSENT_KEY, enabled)
  if (!enabled) cached = null
}

export type GeolocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

/**
 * État réel de la permission géolocalisation côté navigateur, sans déclencher
 * de prompt. Permet à l'UI de distinguer :
 * - 'granted' : tout va bien
 * - 'prompt'  : pas encore demandé, le prochain getCurrentPosition prompera
 * - 'denied'  : bloqué par le navigateur (l'user doit aller dans les
 *               paramètres du site pour réautoriser, le prompt n'apparaîtra
 *               plus jamais)
 * - 'unsupported' : Permissions API non disponible (anciens navigateurs)
 */
export async function getGeolocationPermissionState(): Promise<GeolocationPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unsupported'
  }
  try {
    const status = await navigator.permissions.query({
      name: 'geolocation' as PermissionName,
    })
    return status.state as GeolocationPermissionState
  } catch {
    return 'unsupported'
  }
}

export async function requestLocationPermission(): Promise<boolean> {
  if (!isNative) {
    if (!('geolocation' in navigator)) return false

    // Si le navigateur a déjà bloqué la permission (refus précédent + Chrome
    // ajoute le site à une blocklist silencieuse), getCurrentPosition() ne
    // déclenche AUCUN prompt et timeout après 10s. On évite le délai inutile
    // en interrogeant l'état préalable.
    const state = await getGeolocationPermissionState()
    if (state === 'denied') return false

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { timeout: 10000 }
      )
    })
  }

  try {
    const perm = await Geolocation.requestPermissions({ permissions: ['location'] })
    return perm.location === 'granted'
  } catch {
    return false
  }
}

/**
 * Collect positions over a window, keep the best (lowest accuracy radius).
 * Android's FusedLocationProvider emits Wi-Fi fixes immediately then GPS
 * fixes 3-10s later — taking the first fix often returns stale Wi-Fi.
 * We wait for a GPS lock (accuracy <50m) or the 10s timeout.
 */
async function getBestFixNative(): Promise<UserLocation | null> {
  return new Promise<UserLocation | null>((resolve) => {
    let best: UserLocation | null = null
    let settled = false
    let watchId: string | null = null

    const finish = () => {
      if (settled) return
      settled = true
      if (watchId) Geolocation.clearWatch({ id: watchId }).catch(() => {})
      resolve(best)
    }

    const timer = setTimeout(finish, WATCH_TIMEOUT_MS)

    Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: WATCH_TIMEOUT_MS, maximumAge: 0 },
      (pos, err) => {
        if (err || !pos) return
        const fix: UserLocation = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        }
        if (!best || fix.accuracy < best.accuracy) best = fix
        if (fix.accuracy <= GOOD_ACCURACY_M) {
          clearTimeout(timer)
          finish()
        }
      }
    ).then((id) => {
      watchId = id
      if (settled) Geolocation.clearWatch({ id }).catch(() => {})
    }).catch(() => {
      clearTimeout(timer)
      finish()
    })
  })
}

async function getBestFixWeb(): Promise<UserLocation | null> {
  if (!('geolocation' in navigator)) return null
  return new Promise<UserLocation | null>((resolve) => {
    let best: UserLocation | null = null
    let settled = false
    let watchId: number | null = null

    const finish = () => {
      if (settled) return
      settled = true
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      resolve(best)
    }

    const timer = setTimeout(finish, WATCH_TIMEOUT_MS)

    // getCurrentPosition() first — its prompt is more reliable on Chrome
    // Android than watchPosition() in PWA contexts (some users never see
    // the permission dialog when watchPosition is the only call). Once the
    // user grants permission and we have a first fix, watchPosition takes
    // over to refine accuracy until GOOD_ACCURACY_M or timeout.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const fix: UserLocation = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        }
        best = fix
        if (fix.accuracy <= GOOD_ACCURACY_M) {
          clearTimeout(timer)
          finish()
          return
        }

        watchId = navigator.geolocation.watchPosition(
          (pos2) => {
            const fix2: UserLocation = {
              latitude: pos2.coords.latitude,
              longitude: pos2.coords.longitude,
              accuracy: pos2.coords.accuracy,
              capturedAt: Date.now(),
            }
            if (!best || fix2.accuracy < best.accuracy) best = fix2
            if (fix2.accuracy <= GOOD_ACCURACY_M) {
              clearTimeout(timer)
              finish()
            }
          },
          () => {
            // Watch errors after initial fix are non-fatal — keep the
            // initial fix and let the timer settle the promise.
          },
          { enableHighAccuracy: true, timeout: WATCH_TIMEOUT_MS, maximumAge: 0 }
        )
      },
      () => {
        clearTimeout(timer)
        finish()
      },
      { enableHighAccuracy: true, timeout: WATCH_TIMEOUT_MS, maximumAge: 0 }
    )
  })
}

export async function getUserLocation(options?: { forceFresh?: boolean }): Promise<UserLocation | null> {
  if (!isLocationConsentEnabled()) return null

  const forceFresh = options?.forceFresh === true
  if (!forceFresh && cached && Date.now() - cached.capturedAt < CACHE_TTL_MS) {
    return cached
  }

  if (isNative) {
    try {
      const perm = await Geolocation.checkPermissions()
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null
    } catch {
      return null
    }
    const fix = await getBestFixNative()
    if (fix) cached = fix
    return fix
  }

  const fix = await getBestFixWeb()
  if (fix) cached = fix
  return fix
}

export function clearLocationCache(): void {
  cached = null
}
