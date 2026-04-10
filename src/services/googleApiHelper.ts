import { getValidAccessToken } from './googleAuth'
import { safeJson } from '../utils/safeJson'

export async function callGoogleApi(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<any> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Google non connecté.')
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  return safeJson(res)
}

export async function callApi(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<any> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return safeJson(res)
}
