import type {
  PriceSearchResponse,
  WpPublishRequest,
  WpPublishResponse,
  FormField,
  FormFillResponse,
  ScreenshotResponse,
} from '../types/browser'

export async function publishWordPress(data: WpPublishRequest): Promise<WpPublishResponse> {
  const res = await fetch('/api/wordpress/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.error || 'Erreur publication WordPress')
  return result
}

export async function searchPrices(query: string): Promise<PriceSearchResponse> {
  const res = await fetch('/api/browser/search-price', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.error || 'Erreur recherche prix')
  return result
}

export async function fillForm(
  url: string,
  fields: FormField[],
  submit?: boolean
): Promise<FormFillResponse> {
  const res = await fetch('/api/browser/fill-form', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, fields, submit }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.error || 'Erreur remplissage formulaire')
  return result
}

export async function takeScreenshot(url: string): Promise<ScreenshotResponse> {
  const res = await fetch('/api/browser/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.error || 'Erreur screenshot')
  return result
}
