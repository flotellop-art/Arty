import type { GoogleTokens, GoogleUser } from '../types/google'

const TOKENS_KEY = 'fp-google-tokens'
const USER_KEY = 'fp-google-user'

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
  const res = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: getRedirectUri() }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Token exchange failed')

  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }

  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  return tokens
}

export async function refreshAccessToken(): Promise<GoogleTokens | null> {
  const tokens = getStoredTokens()
  if (!tokens?.refresh_token) return null

  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  })

  const data = await res.json()
  if (!res.ok) {
    logout()
    return null
  }

  const updated: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  }

  localStorage.setItem(TOKENS_KEY, JSON.stringify(updated))
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
  const data = await res.json()

  const user: GoogleUser = {
    email: data.email,
    name: data.name,
    picture: data.picture,
  }

  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export function getStoredTokens(): GoogleTokens | null {
  try {
    const data = localStorage.getItem(TOKENS_KEY)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

export function getStoredUser(): GoogleUser | null {
  try {
    const data = localStorage.getItem(USER_KEY)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

export function logout(): void {
  localStorage.removeItem(TOKENS_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isConnected(): boolean {
  return getStoredTokens() !== null
}
