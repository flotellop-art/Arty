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

export async function getUserLocation(): Promise<UserLocation | null> {
  if (!isLocationConsentEnabled()) return null

  if (cached && Date.now() - cached.capturedAt < CACHE_TTL_MS) {
    return cached
  }

  if (isNative) {
    try {
      const perm = await Geolocation.checkPermissions()
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null

      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: CACHE_TTL_MS,
      })
      cached = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        capturedAt: Date.now(),
      }
      return cached
    } catch {
      return null
    }
  }

  if (!('geolocation' in navigator)) return null
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cached = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        }
        resolve(cached)
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: CACHE_TTL_MS }
    )
  })
}

export function clearLocationCache(): void {
  cached = null
}
