import type { Env } from '../../env'
import { emailTrialKey, resolveProxyIdentity } from '../_lib/emailTrial'
import { consumeCapAtomic, maybeCleanup } from '../_lib/atomicQuota'

/**
 * Signalement de contenu généré par l'IA — exigence de la policy Play Store
 * « AI-Generated Content » (bouton de signalement in-app obligatoire).
 *
 * POST /api/report — auth : token Google (aud vérifié) OU jeton d'essai email
 * via resolveProxyIdentity(), car TOUT utilisateur qui génère du contenu doit
 * pouvoir le signaler. Stocke un extrait tronqué en D1 (juridiction EU) —
 * c'est un rapport PRIVÉ vers le développeur, pas une publication : les
 * conversations euOnly sont donc acceptées (contrairement à /api/share).
 *
 * Garde-fous (RÈGLE 6) :
 * - reporter_email dérivé du token vérifié, JAMAIS du body.
 * - Catégorie en liste blanche stricte, longueurs bornées serveur.
 * - Rate limit 20 signalements / 24 h / user (compteur atomique D1).
 * - Erreurs génériques ; ne JAMAIS logger le contenu du rapport (extraits
 *   potentiellement sensibles → pas dans les logs Cloudflare).
 */

const CATEGORIES = new Set(['offensive', 'dangerous', 'misinformation', 'other'])
const MAX_EXCERPT_CHARS = 2100 // client tronque à 2000 + '…' ; on re-borne large
const MAX_FREE_TEXT_CHARS = 600
const DAILY_REPORT_CAP = 20
const RETENTION_DAYS = 180

interface ReportPayload {
  category?: unknown
  freeText?: unknown
  messageExcerpt?: unknown
  precedingExcerpt?: unknown
  usedModelsInConversation?: unknown
  euOnly?: unknown
}

async function ensureTable(env: Env): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS content_reports (
        id TEXT PRIMARY KEY,
        reporter_email TEXT NOT NULL,
        category TEXT NOT NULL,
        free_text TEXT,
        message_excerpt TEXT NOT NULL,
        preceding_excerpt TEXT,
        used_models_json TEXT,
        eu_only INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`
    ).run()
    // Table partagée du rate-limit (aussi créée par share/memory-extract) —
    // garantie ici pour que le cap ne fail-open pas au tout premier rapport.
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
    // Code d'erreur uniquement — jamais de payload utilisateur dans les logs.
    console.error('[report] ensure table failed', err)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const identity = await resolveProxyIdentity(request, env)
  if (!identity) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!env.DB) {
    return Response.json({ error: 'report_unavailable' }, { status: 503 })
  }
  // Même convention d'identifiant que le reste du backend : les essais email
  // sont préfixés pour ne jamais entrer en collision avec un compte Google.
  const reporterEmail =
    identity.kind === 'email-trial' ? emailTrialKey(identity.email) : identity.email

  let payload: ReportPayload
  try {
    payload = (await request.json()) as ReportPayload
  } catch {
    return Response.json({ error: 'invalid_report' }, { status: 400 })
  }

  const category = typeof payload.category === 'string' ? payload.category : ''
  if (!CATEGORIES.has(category)) {
    return Response.json({ error: 'invalid_report' }, { status: 400 })
  }
  const messageExcerpt =
    typeof payload.messageExcerpt === 'string'
      ? payload.messageExcerpt.slice(0, MAX_EXCERPT_CHARS)
      : ''
  if (!messageExcerpt.trim()) {
    return Response.json({ error: 'invalid_report' }, { status: 400 })
  }
  const freeText =
    typeof payload.freeText === 'string'
      ? payload.freeText.slice(0, MAX_FREE_TEXT_CHARS)
      : ''
  const precedingExcerpt =
    typeof payload.precedingExcerpt === 'string'
      ? payload.precedingExcerpt.slice(0, MAX_EXCERPT_CHARS)
      : ''
  const usedModels = Array.isArray(payload.usedModelsInConversation)
    ? payload.usedModelsInConversation.filter((x) => typeof x === 'string').slice(0, 8)
    : []

  await ensureTable(env)
  await maybeCleanup(
    env,
    `DELETE FROM content_reports WHERE created_at < unixepoch() - ?1`,
    [RETENTION_DAYS * 86400]
  )

  const day = new Date().toISOString().slice(0, 10)
  const rl = await consumeCapAtomic(
    env,
    `INSERT INTO bg_quota (email, day, task, count, updated_at)
     VALUES (?1, ?2, ?3, 1, unixepoch())
     ON CONFLICT (email, day, task) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       WHERE bg_quota.count < ?4
     RETURNING count`,
    [reporterEmail, day, 'content-report', DAILY_REPORT_CAP]
  )
  if (rl.status === 'cap_reached') {
    return Response.json({ error: 'report_rate_limit' }, { status: 429 })
  }

  try {
    await env.DB.prepare(
      `INSERT INTO content_reports
        (id, reporter_email, category, free_text, message_excerpt, preceding_excerpt, used_models_json, eu_only)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
      .bind(
        crypto.randomUUID(),
        reporterEmail,
        category,
        freeText,
        messageExcerpt,
        precedingExcerpt,
        JSON.stringify(usedModels),
        payload.euOnly === true ? 1 : 0
      )
      .run()
  } catch {
    // Volontairement muet sur le détail : un INSERT raté ne doit jamais
    // écrire l'extrait signalé (contenu potentiellement sensible) en logs.
    console.error('[report] insert failed')
    return Response.json({ error: 'report_failed' }, { status: 500 })
  }

  return Response.json({ ok: true })
}
