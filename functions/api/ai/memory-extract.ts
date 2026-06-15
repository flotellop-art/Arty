import type { Env } from '../../env'
import { verifyGoogleUser } from '../_lib/checkAllowedUser'
import { consumeCapAtomic } from '../_lib/atomicQuota'
import { recordUsage } from '../_lib/quota'

/**
 * P1.1 — Extraction de mémoire automatique (plan d'action concurrentiel).
 *
 * Endpoint DÉDIÉ, hors quota utilisateur : contrairement au proxy IA
 * (/api/ai/proxy), un appel ici ne consomme NI le compteur trial NI le quota
 * journalier — c'est un coût opérationnel Arty (~0,001 $/appel Haiku),
 * pas un message utilisateur. (Piège documenté : le brief proactif passe par
 * le proxy et mange le quota — ne pas reproduire.)
 *
 * Garde-fous :
 * - Auth Google obligatoire (anti-relais anonyme, CRIT-4).
 * - Rate-limit propre : 20 extractions/utilisateur/jour (compteur atomique D1).
 * - Modèle FORCÉ Haiku, max_tokens 400, texte d'entrée tronqué côté serveur.
 * - recordUsage trace le coût réel en D1 (sans incrémenter les compteurs
 *   de quota visibles).
 *
 * Le prompt d'extraction vit ICI (pas côté client) : règles anti-hallucination
 * (faits explicites uniquement, citation source) et liste d'exclusion des
 * données sensibles non négociables côté serveur.
 */

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'
const DAILY_EXTRACT_CAP = 20
const MAX_TRANSCRIPT_CHARS = 6000
const MAX_FACTS_CHARS = 5000

const EXTRACTION_SYSTEM = `Tu extrais des faits durables sur l'utilisateur depuis ses messages, pour personnaliser un assistant personnel.

RÈGLES STRICTES, NON NÉGOCIABLES :
1. UNIQUEMENT des informations EXPLICITEMENT énoncées par l'utilisateur. Aucune inférence, aucune déduction, aucune généralisation.
2. EXCLUS SYSTÉMATIQUEMENT tout fait relevant de : la santé physique ou mentale, les opinions politiques/religieuses/philosophiques, la vie sentimentale ou intime, les montants financiers précis (salaires, dettes), et les informations sur des tiers identifiables (noms de personnes privées + détail personnel).
3. Garde uniquement les faits DURABLES (préférences, métier, contexte de travail, projets en cours, habitudes) — pas les demandes ponctuelles.
4. Chaque fait : max 120 caractères, formulé en 3e personne (« L'utilisateur … »), dans la langue de la conversation.
5. Compare avec les FAITS EXISTANTS fournis : n'ajoute JAMAIS un doublon ou une reformulation. Si un fait existant est contredit ou périmé par la conversation, retourne un remplacement avec son id.
6. En cas de doute, n'extrais RIEN. Une mémoire vide vaut mieux qu'une mémoire fausse.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown :
{"add":[{"fact":"…","source":"citation exacte du message utilisateur"}],"replace":[{"id":"lm-…","fact":"…"}]}
Si rien à retenir : {"add":[],"replace":[]}`

interface ExtractRequest {
  transcript?: unknown
  facts?: unknown
}

interface ExistingFact {
  id: string
  content: string
}

function sanitizeFacts(raw: unknown): ExistingFact[] {
  if (!Array.isArray(raw)) return []
  const out: ExistingFact[] = []
  let total = 0
  for (const f of raw) {
    const id = (f as { id?: unknown })?.id
    const content = (f as { content?: unknown })?.content
    if (typeof id !== 'string' || typeof content !== 'string') continue
    if (!/^lm-[\w-]+$/.test(id)) continue
    const c = content.slice(0, 200)
    total += c.length
    if (total > MAX_FACTS_CHARS) break
    out.push({ id, content: c })
  }
  return out
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await verifyGoogleUser(request, env.GOOGLE_CLIENT_ID)
  if (!email) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'extract_unavailable' }, { status: 503 })
  }

  // Rate-limit dédié : 20/jour/utilisateur (anti-boucle + borne le coût et
  // l'usage de cet endpoint comme mini-proxy Haiku gratuit).
  if (env.DB) {
    try {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS bg_quota (
          email TEXT NOT NULL,
          day TEXT NOT NULL,
          task TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (email, day, task)
        )`
      ).run()
    } catch (err) {
      console.error('[memory-extract] ensure table failed', err)
    }
    const day = new Date().toISOString().slice(0, 10)
    const outcome = await consumeCapAtomic(
      env,
      `INSERT INTO bg_quota (email, day, task, count, updated_at)
       VALUES (?1, ?2, ?3, 1, unixepoch())
       ON CONFLICT (email, day, task) DO UPDATE SET count = count + 1, updated_at = unixepoch()
         WHERE bg_quota.count < ?4
       RETURNING count`,
      [email, day, 'memory-extract', DAILY_EXTRACT_CAP]
    )
    if (outcome.status === 'cap_reached') {
      return Response.json({ error: 'extract_quota' }, { status: 429 })
    }
  }

  let payload: ExtractRequest
  try {
    payload = (await request.json()) as ExtractRequest
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const transcript =
    typeof payload.transcript === 'string'
      ? payload.transcript.slice(0, MAX_TRANSCRIPT_CHARS)
      : ''
  if (transcript.trim().length < 50) {
    return Response.json({ add: [], replace: [] })
  }
  const facts = sanitizeFacts(payload.facts)

  const userContent = `FAITS EXISTANTS :\n${
    facts.length > 0 ? facts.map((f) => `[${f.id}] ${f.content}`).join('\n') : '(aucun)'
  }\n\nMESSAGES RÉCENTS DE L'UTILISATEUR :\n${transcript}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: EXTRACT_MODEL,
        max_tokens: 400,
        system: EXTRACTION_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      }),
    })

    if (!res.ok) {
      console.error('[memory-extract] upstream', res.status, await res.text().catch(() => ''))
      return Response.json({ error: 'extract_failed' }, { status: 502 })
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }

    // Tracking coût réel (sans toucher aux compteurs de quota visibles).
    await recordUsage(env, email, EXTRACT_MODEL, {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      audioSeconds: 0,
    })

    const text = data.content?.find((b) => b.type === 'text')?.text ?? ''
    let parsed: { add?: unknown; replace?: unknown } = {}
    try {
      // Haiku peut entourer le JSON de texte — on isole le premier objet.
      const match = text.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0]) as typeof parsed
    } catch {
      // JSON invalide → extraction vide, jamais d'erreur côté client.
    }

    // Validation stricte de la forme avant de relayer au client.
    const add = (Array.isArray(parsed.add) ? parsed.add : [])
      .map((a) => ({
        fact: typeof (a as { fact?: unknown })?.fact === 'string' ? ((a as { fact: string }).fact).slice(0, 160) : '',
      }))
      .filter((a) => a.fact.length > 4)
      .slice(0, 5)
    const replace = (Array.isArray(parsed.replace) ? parsed.replace : [])
      .map((r) => ({
        id: typeof (r as { id?: unknown })?.id === 'string' ? (r as { id: string }).id : '',
        fact: typeof (r as { fact?: unknown })?.fact === 'string' ? ((r as { fact: string }).fact).slice(0, 160) : '',
      }))
      .filter((r) => /^lm-[\w-]+$/.test(r.id) && r.fact.length > 4)
      .slice(0, 5)

    return Response.json({ add, replace })
  } catch (err) {
    console.error('[memory-extract] failed', err)
    return Response.json({ error: 'extract_failed' }, { status: 502 })
  }
}
