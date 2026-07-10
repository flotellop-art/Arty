import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

export async function callGoogleApi(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<any> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Google non connecté.')
  const res = await fetch(apiUrl(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(`Google API request failed (${res.status})`)
  return data
}

export async function callApi(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<any> {
  const res = await fetch(apiUrl(endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(`API request failed (${res.status})`)
  return data
}
