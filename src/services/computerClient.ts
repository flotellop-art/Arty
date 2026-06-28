import type { ComputerAction, ComputerActionResponse } from '../types/computer'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'
import { getValidAccessToken } from './googleAuth'

export async function sendComputerAction(
  action: ComputerAction,
  params?: Record<string, unknown>
): Promise<ComputerActionResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Le relay /api/computer/relay exige le token Google de l'owner pour
  // s'authentifier. Sans ce header, il répond 404 et la feature est morte.
  // getValidAccessToken rafraîchit le token avant envoi (BUG 23 — ne pas
  // utiliser getStoredTokens qui peut renvoyer un token expiré).
  const token = await getValidAccessToken()
  if (token) headers['x-google-token'] = token

  const res = await fetch(apiUrl('/api/computer/relay'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, params }),
  })
  const data = await safeJson(res)
  if (!res.ok) throw new Error((data.error as string) || 'Erreur contrôle PC')
  return data
}

export async function screenshotPC(): Promise<ComputerActionResponse> {
  return sendComputerAction('screenshot')
}

export async function openApp(app: string): Promise<ComputerActionResponse> {
  return sendComputerAction('open_app', { app })
}

export async function clickAt(x: number, y: number): Promise<ComputerActionResponse> {
  return sendComputerAction('click', { x, y })
}

export async function typeOnPC(text: string): Promise<ComputerActionResponse> {
  return sendComputerAction('type', { text })
}

export async function scrollPC(direction: 'up' | 'down', amount?: number): Promise<ComputerActionResponse> {
  return sendComputerAction('scroll', { direction, amount })
}

export async function pressKeyPC(key: string): Promise<ComputerActionResponse> {
  return sendComputerAction('key', { key })
}
