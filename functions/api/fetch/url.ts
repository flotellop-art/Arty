// Authenticated public URL reader shared by PDF preparation, fetch_url and
// Anthropic URL recovery. Browser Run is a PRIVATE service binding, selected
// only by explicit new-client public-browser policy and a server feature flag.
// Legacy clients, EU-only turns and PDFs retain Linkup. This routing decision
// does not attest any provider's processing geography.
//
// Browser network authority is its fixed server profile (never user/model
// domains), with all-plan global/user admission in an isolated Worker. A
// browser refusal does not trigger Linkup. Unsupported profiles are detected
// before acquisition and may use the existing Linkup path.
//
// Arty never fetches the supplied URL directly. isSafePublicUrl is lexical,
// not a DNS/IP attestation. Auth/admission failure refuses before dispatch;
// Linkup's non-paid quota is retained. Provider bodies/statuses stay opaque.
// Origin/CSRF is enforced by functions/api/_middleware.ts.
import type { Env } from '../../env'
import { isAdmissionUnavailable, admissionUnavailableResponse } from '../_lib/admission'
import { checkAllowedUserPeek } from '../_lib/checkAllowedUser'
import {
  consumeOwnerApiQuota,
  ownerApiLimitResponse,
  planSubjectToOwnerApiCap,
} from '../_lib/freeQuota'
import { isSafePublicUrl, isShortLinkHost } from '../_lib/urlSafety'
import { truncateWithNotice } from '../_lib/truncate'
import { fetchBrowserPage } from '../_lib/browserReader'
import { readRequestTextWithLimit } from '../_lib/boundedRequestBody'

const MAX_URL_LEN = 2048
const MAX_MARKDOWN_CHARS = 200_000

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Peek : vérifie l'identité Google sans décrémenter le trial (endpoint
  // auxiliaire, comme /api/search/web).
  const user = await checkAllowedUserPeek(request, env)
  if (isAdmissionUnavailable(user)) return admissionUnavailableResponse()
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { url?: unknown; readerPolicy?: unknown }
  try {
    body = JSON.parse(await readRequestTextWithLimit(request, 4096))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body')
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const rawUrl = body.url
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LEN) {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  if (!isSafePublicUrl(parsed)) {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }
  if (body.readerPolicy !== undefined && body.readerPolicy !== 'eu-only' && body.readerPolicy !== 'public-browser') {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Lot C (audit Mistral) : PDF ET pages web acceptés — voir l'en-tête pour
  // l'analyse sécurité de la levée du PDF-only. On refuse seulement les
  // extensions binaires évidentes que Linkup ne convertira pas en texte
  // utile (médias, archives, exécutables) pour ne pas brûler du quota.
  if (/\.(mp4|webm|avi|mov|mp3|wav|ogg|zip|rar|7z|tar|gz|exe|dmg|apk|iso|img|bin)$/i.test(parsed.pathname)) {
    return Response.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  // Keep EU-only and PDF turns on the legacy route. This does not attest
  // Linkup processing geography; it prevents a new global browser transfer.
  if (!/\.pdf$/i.test(parsed.pathname) && body.readerPolicy === 'public-browser') {
    const browserResponse = await fetchBrowserPage(env, request, parsed.toString(), user.email)
    if (browserResponse) return browserResponse
  }
  if (!env.LINKUP_API_KEY) {
    return Response.json({ error: 'Fetch unavailable' }, { status: 503 })
  }

  // Cap journalier par email sur la clé Linkup PAYANTE du owner — uniquement
  // les plans non-payants. Placé après la validation d'URL (les requêtes
  // invalides ne consomment pas de quota) et avant le fetch facturé. Filet
  // multi-comptes = plafond DUR Linkup (cf. docs ops).
  if (planSubjectToOwnerApiCap(user.planType)) {
    const cap = await consumeOwnerApiQuota(env, user.email, 'url-fetch')
    if (cap.unavailable) return admissionUnavailableResponse()
    if (!cap.allowed) return ownerApiLimitResponse('url-fetch', cap.limit)
  }

  // renderJs uniquement pour les liens de partage Google (interstitiel JS).
  const renderJs = isShortLinkHost(parsed.hostname)

  const controller = new AbortController()
  const onAbort = () => controller.abort(request.signal.reason)
  request.signal.addEventListener('abort', onAbort, { once: true })
  if (request.signal.aborted) onAbort()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const res = await fetch('https://api.linkup.so/v1/fetch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LINKUP_API_KEY}`,
      },
      body: JSON.stringify({
        url: parsed.toString(),
        includeRawHtml: false,
        extractImages: false,
        ...(renderJs ? { renderJs: true } : {}),
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Erreur opaque — ne pas révéler le status/body Linkup au client.
      return Response.json({ error: 'Fetch failed' }, { status: 502 })
    }
    const data = (await res.json()) as { markdown?: string }
    const raw = data.markdown ?? ''
    if (!raw) {
      return Response.json({ error: 'Empty document' }, { status: 502 })
    }
    // Coupe AVEC note visible si le Markdown dépasse la limite (rare : ~50k
    // tokens) au lieu d'une coupe muette.
    const { text: markdown, truncated, originalLength } = truncateWithNotice(raw, MAX_MARKDOWN_CHARS)
    return Response.json({ markdown, truncated, originalLength, provider: 'linkup' })
  } catch {
    return Response.json({ error: 'Fetch failed' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', onAbort)
  }
}
