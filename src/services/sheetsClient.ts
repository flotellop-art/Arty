/**
 * Google Sheets client (Feature 9).
 * Uses the user's Google token via x-google-token header.
 */

import { getValidAccessToken } from './googleAuth'
import { apiUrl } from './apiBase'
import { safeJson } from '../utils/safeJson'

export async function createSheet(title: string, headers: string[]): Promise<{ spreadsheetId: string; url: string }> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Google non connecté.')
  const res = await fetch(apiUrl('/api/sheets/append'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-google-token': token },
    body: JSON.stringify({ action: 'create', title, headers }),
  })
  const data = await safeJson(res)
  if (!res.ok) throw new Error((data.error as string) || 'Sheets create failed')
  return { spreadsheetId: data.spreadsheetId as string, url: data.url as string }
}

export async function appendRow(
  spreadsheetId: string,
  sheetName: string,
  values: string[]
): Promise<{ success: boolean; updatedRows: number }> {
  const token = await getValidAccessToken()
  if (!token) throw new Error('Google non connecté.')
  const res = await fetch(apiUrl('/api/sheets/append'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-google-token': token },
    body: JSON.stringify({ action: 'append', spreadsheetId, sheetName, values }),
  })
  const data = await safeJson(res)
  if (!res.ok) throw new Error((data.error as string) || 'Sheets append failed')
  return { success: true, updatedRows: (data.updatedRows as number) || 0 }
}
