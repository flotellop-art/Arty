import type { ComputerAction, ComputerActionResponse } from '../types/computer'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

export async function sendComputerAction(
  action: ComputerAction,
  params?: Record<string, unknown>
): Promise<ComputerActionResponse> {
  const res = await fetch(apiUrl('/api/computer/relay'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
