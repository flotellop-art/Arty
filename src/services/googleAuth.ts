import type { GoogleTokens, GoogleUser } from '../types/google'
import { safeJson } from '../utils/safeJson'
import * as scoped from './scopedStorage'
import { apiUrl } from './apiBase'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')

export function getRedirectUri(): string {
  return import.meta.env.VITE_GOOGLE_REDIRECT_URI || `${window.location.origin}/auth/callback`
}

export function buildOAuthUrl(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID manquant')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(apiUrl('/api/auth/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: getRedirectUri() }),
  })

  const data = await safeJson(res)
  if (!res.ok) throw new Error((data.error as string) || 'Token exchange failed')

  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }

  await storeTokens(tokens)
  return tokens
}

async function storeTokens(tokens: GoogleTokens): Promise<void> {
  scoped.setJSON('google-tokens', tokens)
}

export async function refreshAccessToken(): Promise<GoogleTokens | null> {
  const tokens = getStoredTokens()
  if (!tokens?.refresh_token) return null

  const res = await fetch(apiUrl('/api/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any
  try { data = await safeJson(res) } catch { logout(); return null }
  if (!res.ok) {
    logout()
    return null
  }

  const updated: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }

  await storeTokens(updated)
  return updated
}

export async function getValidAccessToken(): Promise<string | null> {
  let tokens = getStoredTokens()
  if (!tokens) return null

  // Refresh if expiring within 5 minutes
  if (tokens.expires_at - Date.now() < 5 * 60 * 1000) {
    tokens = await refreshAccessToken()
    if (!tokens) return null
  }

  return tokens.access_token
}

export async function fetchGoogleUser(accessToken: string): Promise<GoogleUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) throw new Error('Failed to fetch user info')
  const data = await safeJson(res)

  const user: GoogleUser = {
    email: data.email,
    name: data.name,
    picture: data.picture,
  }

  scoped.setJSON('google-user', user)
  return user
}

export function getStoredTokens(): GoogleTokens | null {
  return scoped.getJSON<GoogleTokens>('google-tokens')
}

export function getStoredUser(): GoogleUser | null {
  return scoped.getJSON<GoogleUser>('google-user')
}

export function logout(): void {
  scoped.removeItem('google-tokens')
  scoped.removeItem('google-user')
}

export function isConnected(): boolean {
  return getStoredTokens() !== null
}
