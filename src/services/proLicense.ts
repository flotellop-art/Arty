/**
 * Pro license — local activation state + API binding.
 *
 * Storage layout (plain localStorage, not scoped to the user — a license
 * is bound to the device, not to a single Arty session):
 *   `arty-device-id`  — stable UUID v4 generated once at first call.
 *   `arty-pro-license` — { activated: true, email, license_key, activatedAt }
 *                       written after a successful POST /api/license/activate.
 *
 * Security note: `license_key` is stored in plain localStorage so the user
 * can re-validate the license on subsequent launches. It is NOT a secret
 * (the server is the source of truth — clients can only request activation,
 * never grant it). If/when we want to hide it from a casual local-storage
 * inspector we can move it behind `secureSetJSON`, but that requires
 * `initCrypto()` which races with the boot path (see BUG 16, 43).
 */

import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'

const DEVICE_ID_KEY = 'arty-device-id'
const PRO_LICENSE_KEY = 'arty-pro-license'

export interface ProLicenseState {
  activated: boolean
  email: string
  license_key: string
  activatedAt: number
}

export type ActivateResult =
  | { ok: true; state: ProLicenseState }
  | { ok: false; error: string }

/** Returns the stable device id, generating one on first call. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = generateUuid()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

function generateUuid(): string {
  // Prefer the platform RNG (`crypto.randomUUID`) when available — it's
  // both faster and produces a v4 UUID. Fallback to `getRandomValues`
  // for older WebViews where `randomUUID` is missing.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Set version (4) and variant (10xx) bits per RFC 4122
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getProLicense(): ProLicenseState | null {
  try {
    const raw = localStorage.getItem(PRO_LICENSE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProLicenseState
    return parsed.activated ? parsed : null
  } catch {
    return null
  }
}

export function isProActivated(): boolean {
  return getProLicense() !== null
}

function setProLicense(state: ProLicenseState): void {
  localStorage.setItem(PRO_LICENSE_KEY, JSON.stringify(state))
  window.dispatchEvent(new CustomEvent('pro-license-changed'))
}

export async function activateLicense(
  licenseKey: string,
  email: string
): Promise<ActivateResult> {
  const trimmedKey = licenseKey.trim()
  const trimmedEmail = email.trim().toLowerCase()
  if (!trimmedKey) return { ok: false, error: 'Clé de licence requise.' }
  if (!trimmedEmail) return { ok: false, error: 'Email requis.' }

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // Forward the Google token when available so the server can verify the
  // request comes from the authenticated user (defense-in-depth — the
  // server is still the source of truth).
  const token = await getValidAccessToken()
  if (token) headers['x-google-token'] = token

  let res: Response
  try {
    res = await fetch(apiUrl('/api/license/activate'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        license_key: trimmedKey,
        email: trimmedEmail,
        device_id: getDeviceId(),
      }),
    })
  } catch {
    return { ok: false, error: 'Connexion impossible. Réessaie dans un instant.' }
  }

  if (!res.ok) {
    let msg = `Activation refusée (${res.status}).`
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      if (body?.error) msg = body.error
      else if (body?.message) msg = body.message
    } catch {
      // body might not be JSON — keep the status-based fallback
    }
    return { ok: false, error: msg }
  }

  const state: ProLicenseState = {
    activated: true,
    email: trimmedEmail,
    license_key: trimmedKey,
    activatedAt: Date.now(),
  }
  setProLicense(state)
  return { ok: true, state }
}
