import type {
  PriceSearchResponse,
  WpPublishRequest,
  WpPublishResponse,
  FormField,
  FormFillResponse,
  ScreenshotResponse,
} from '../types/browser'
import { safeJson } from '../utils/safeJson'
import { apiUrl } from './apiBase'

export async function publishWordPress(data: WpPublishRequest): Promise<WpPublishResponse> {
  const res = await fetch(apiUrl('/api/wordpress/publish'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result = await safeJson(res)
  if (!res.ok) throw new Error((result.error as string) || 'Erreur publication WordPress')
  return result
}

export async function searchPrices(query: string): Promise<PriceSearchResponse> {
  const res = await fetch(apiUrl('/api/browser/action'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'search-price', query }),
  })
  const result = await safeJson(res)
  if (!res.ok) throw new Error((result.error as string) || 'Erreur recherche prix')
  return result
}

export async function fillForm(
  url: string,
  fields: FormField[],
  submit?: boolean
): Promise<FormFillResponse> {
  const res = await fetch(apiUrl('/api/browser/action'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'fill-form', url, fields, submit }),
  })
  const result = await safeJson(res)
  if (!res.ok) throw new Error((result.error as string) || 'Erreur remplissage formulaire')
  return result
}

export async function takeScreenshot(url: string): Promise<ScreenshotResponse> {
  const res = await fetch(apiUrl('/api/browser/action'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'screenshot', url }),
  })
  const result = await safeJson(res)
  if (!res.ok) throw new Error((result.error as string) || 'Erreur screenshot')
  return result
}
