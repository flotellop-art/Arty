// Client pour /api/fetch/url : convertit une URL de PDF public en Markdown
// (via Linkup côté serveur). Utilisé par useConversation quand l'utilisateur
// colle un lien .pdf — Claude `web_fetch` ne lit pas les PDF binaires.
//
// Tolérant aux échecs : si un fetch rate (PDF mort, Linkup down, trop gros),
// on l'ignore silencieusement et on laisse le message partir tel quel — Claude
// tentera son web_fetch natif. Jamais d'erreur bloquante côté UI.

import { getValidAccessToken } from './googleAuth'

// Cap dur : un message ne déclenche au plus que ce nombre de fetch PDF, pour
// éviter d'épuiser le quota Linkup (clé serveur du owner) si quelqu'un colle
// 20 liens d'un coup.
const MAX_PDFS_PER_MESSAGE = 3

async function fetchOne(url: string, token: string | null): Promise<{ url: string; markdown: string } | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['x-google-token'] = token
    const res = await fetch('/api/fetch/url', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { markdown?: string }
    if (!data.markdown) return null
    return { url, markdown: data.markdown }
  } catch {
    return null
  }
}

/**
 * Récupère le Markdown de chaque URL PDF et renvoie un bloc texte prêt à
 * injecter dans le message envoyé au LLM, ou `null` si rien n'a pu être lu.
 */
export async function fetchPdfMarkdowns(urls: string[]): Promise<string | null> {
  if (!urls.length) return null
  const token = await getValidAccessToken()
  const picked = urls.slice(0, MAX_PDFS_PER_MESSAGE)
  const results = await Promise.all(picked.map((u) => fetchOne(u, token)))
  const ok = results.filter((r): r is { url: string; markdown: string } => r !== null)
  if (!ok.length) return null
  return ok
    .map((r) => `--- CONTENU DU PDF (${r.url}) ---\n${r.markdown}\n--- FIN DU PDF ---`)
    .join('\n\n')
}

// Lot C (audit Mistral, juin 2026) — pages web pour les conversations euOnly.
// Une page d'article peut être très longue : on borne chaque page côté client
// pour ne pas noyer le contexte Mistral (les PDF gardent le cap serveur seul,
// un PDF métier mérite d'entrer entier).
const MAX_PAGE_CHARS = 12_000

/**
 * Récupère le Markdown de pages web (via Linkup, hébergé EU) et renvoie un
 * bloc prêt à injecter dans le message, ou `null` si rien n'a pu être lu.
 * Utilisé pour les conversations euOnly : Mistral n'a aucune lecture d'URL —
 * sans ce fetch, un lien collé partait dans le vide (hallucinations PR #162).
 */
export async function fetchUrlMarkdowns(urls: string[]): Promise<string | null> {
  if (!urls.length) return null
  const token = await getValidAccessToken()
  const picked = urls.slice(0, MAX_PDFS_PER_MESSAGE)
  const results = await Promise.all(picked.map((u) => fetchOne(u, token)))
  const ok = results.filter((r): r is { url: string; markdown: string } => r !== null)
  if (!ok.length) return null
  return ok
    .map((r) => {
      const md = r.markdown.length > MAX_PAGE_CHARS
        ? r.markdown.slice(0, MAX_PAGE_CHARS) + '\n[… contenu tronqué]'
        : r.markdown
      return `--- CONTENU DE LA PAGE (${r.url}) — récupéré via Linkup (EU) ---\n${md}\n--- FIN DE LA PAGE ---`
    })
    .join('\n\n')
}
