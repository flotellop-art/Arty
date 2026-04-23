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
  return scoped.getJSON<boolean>(CONSENT_KEY) === true
}

export function setLocationConsent(enabled: boolean): void {
  scoped.setJSON(CONSENT_KEY, enabled)
  if (!enabled) cached = null
}

export async function requestLocationPermission(): Promise<boolean> {
  if (!isNative) {
    if (!('geolocation' in navigator)) return false
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

    const finish = () => {
      if (settled) return
      settled = true
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      resolve(best)
    }

    const timer = setTimeout(finish, WATCH_TIMEOUT_MS)

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
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
      },
      () => {
        clearTimeout(timer)
        finish()
      },
      { enableHighAccuracy: true, timeout: WATCH_TIMEOUT_MS, maximumAge: 0 }
    )
  })
}

export async function getUserLocation(): Promise<UserLocation | null> {
  if (!isLocationConsentEnabled()) return null

  if (cached && Date.now() - cached.capturedAt < CACHE_TTL_MS) {
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
