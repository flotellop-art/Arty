// Proxy Cloudflare pour convertir une URL PUBLIQUE (PDF ou page web) en
// Markdown via l'endpoint Linkup /v1/fetch. Deux usages :
//  - PDF collés en chat : ni `web_fetch` (Claude) ni `url_context` (Gemini)
//    n'avalent un PDF binaire — Linkup renvoie du Markdown propre.
//  - Pages web pour les conversations euOnly (lot C audit Mistral, juin
//    2026) : Mistral n'a aucune lecture d'URL ; Linkup (hébergé EU) lit la
//    page et le contenu est inliné dans le message — les données restent
//    en Europe. Avant : restriction PDF-only → les liens collés en conv EU
//    partaient dans le vide (hallucinations PR #162).
// Réutilise LINKUP_API_KEY (déjà utilisée par /api/search/web).
//
// Liens de partage Android (share.google…) : Linkup ne suit pas leur
// interstitiel JS sans `renderJs`. On l'active conditionnellement pour ces
// hôtes (audit 11 juin). DÉCISION D'ARCHI : on NE résout PAS la redirection
// nous-mêmes côté Worker — 4 audits agents ont montré qu'un fetch de
// résolution réintroduirait un vrai SSRF (contournements nip.io, trailing
// dot, DNS rebinding non maîtrisable sur Workers). C'est toujours Linkup qui
// fetche : l'invariant ci-dessous reste vrai.
//
// Sécurité (RÈGLE 6) :
//  - Auth obligatoire (checkAllowedUserPeek) — anti relais anonyme (CRIT-4).
//  - C'est Linkup qui fait le fetch sortant, PAS notre Worker : le SSRF
//    classique contre l'infra Cloudflare n'existe pas. La validation d'URL
//    ci-dessous évite quand même d'être un vecteur d'abus vers des hosts
//    internes via l'infra Linkup. `isSafePublicUrl` durcie (11 juin) :
//    trailing dot normalisé + IPv4 embarquée (nip.io) rejetée. DNS rebinding
//    pur non maîtrisable côté Arty (accepté ; borné à l'infra Linkup).
//  - Levée du PDF-only (lot C) : l'abus de quota Linkup reste borné par
//    l'auth whitelist/abonnés, le cap de sortie, et le cap client
//    (3 fetch max par message). Risque accepté : un utilisateur authentifié
//    peut fetcher des pages arbitraires sur le quota Linkup du owner — même
//    exposition que web_search qui lui est déjà ouvert sans restriction.
//  - Erreurs opaques : ne JAMAIS propager le body/status Linkup (Leak).
//  - Origin/CSRF : géré globalement par functions/api/_middleware.ts.

import type { Env } from '../../env'
import { checkAllowedUserPeek } from '../_lib/checkAllowedUser'
import { isSafePublicUrl, isShortLinkHost } from '../_lib/urlSafety'
import { truncateWithNotice } from '../_lib/truncate'

const MAX_URL_LEN = 2048
const MAX_MARKDOWN_CHARS = 200_000

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Peek : vérifie l'identité Google sans décrémenter le trial (endpoint
  // auxiliaire, comme /api/search/web).
  const user = await checkAllowedUserPeek(request, env)
  if (!user) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { url?: unknown }
  try {
    body = (await request.json()) as { url?: unknown }
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

  // Lot C (audit Mistral) : PDF ET pages web acceptés — voir l'en-tête pour
  // l'analyse sécurité de la levée du PDF-only. On refuse seulement les
  // extensions binaires évidentes que Linkup ne convertira pas en texte
  // utile (médias, archives, exécutables) pour ne pas brûler du quota.
  if (/\.(mp4|webm|avi|mov|mp3|wav|ogg|zip|rar|7z|tar|gz|exe|dmg|apk|iso|img|bin)$/i.test(parsed.pathname)) {
    return Response.json({ error: 'Unsupported file type' }, { status: 400 })
  }

  if (!env.LINKUP_API_KEY) {
    return Response.json({ error: 'Fetch unavailable' }, { status: 503 })
  }

  // renderJs uniquement pour les liens de partage Google (interstitiel JS).
  const renderJs = isShortLinkHost(parsed.hostname)

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
    return Response.json({ markdown, truncated, originalLength })
  } catch {
    return Response.json({ error: 'Fetch failed' }, { status: 502 })
  }
}
