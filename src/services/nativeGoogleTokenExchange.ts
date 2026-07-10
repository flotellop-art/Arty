import { apiUrl } from './apiBase'
import { withTimeout } from './googleAuth'
import { safeJson } from '../utils/safeJson'

export interface NativeGoogleTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/**
 * Exchange the one-time server auth code returned by the native Google plugin.
 * This helper is deliberately fail-closed: callers must never create an
 * authenticated Arty session without a usable Google access token.
 */
export async function exchangeNativeGoogleCode(serverAuthCode: string): Promise<NativeGoogleTokens> {
  if (!serverAuthCode.trim()) throw new Error('Missing native Google authorization code')

  const timeout = withTimeout(15_000)
  let response: Response
  try {
    response = await fetch(apiUrl('/api/auth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: serverAuthCode, redirect_uri: '' }),
      signal: timeout.signal,
    })
  } finally {
    timeout.cancel()
  }

  const data = await safeJson(response)
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Token exchange failed (${response.status})`)
  }

  const accessToken = typeof data.access_token === 'string' ? data.access_token.trim() : ''
  if (!accessToken) throw new Error('Google token exchange returned no access token')

  const refreshToken = typeof data.refresh_token === 'string' ? data.refresh_token : ''
  const rawExpiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const expiresIn = Number.isFinite(rawExpiresIn) && rawExpiresIn > 0 ? rawExpiresIn : 3600

  return { accessToken, refreshToken, expiresIn }
}
