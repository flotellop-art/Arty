import type { Env } from '../../env'
import { verifyGoogleUser } from '../_lib/checkAllowedUser'
import { consumeCapAtomic, maybeCleanup } from '../_lib/atomicQuota'

/**
 * P1.5 — Création d'un partage public de conversation.
 *
 * POST /api/share — auth Google obligatoire (pas de partage anonyme). Stocke
 * un instantané TEXTE de la conversation en D1 et renvoie un lien opaque
 * `tryarty.com/share/:id` (id = crypto.randomUUID, non devinable).
 *
 * Garde-fous (RÈGLE 6 + posture privacy d'Arty) :
 * - euOnly REFUSÉ : une conversation « confidentielle EU » ne peut pas être
 *   publiée sur un CDN mondial (contredit la promesse). Défense en profondeur
 *   (le client masque déjà le bouton).
 * - Taille bornée (50 000 chars) — limite ligne D1 + zéro intérêt public au-delà.
 * - Rate limit 5 créations / 24 h / user (compteur atomique D1).
 * - Max 20 partages actifs par user.
 * - Le client a déjà retiré fichiers/base64/mémoire/factCheck et neutralisé les
 *   références d'images locales ; le serveur re-borne et stocke tel quel.
 */

const MAX_PAYLOAD_CHARS = 50_000
const MAX_TITLE_CHARS = 200
const DAILY_CREATE_CAP = 5
const MAX_ACTIVE_PER_USER = 20
const TTL_DAYS = 30

interface ShareMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}
interface SharePayload {
  title?: unknown
  messages?: unknown
  usedModels?: unknown
  euOnly?: unknown
  hasGoogleData?: unknown
  createdAt?: unknown
}

async function ensureTable(env: Env): Promise<void> {
  if (!env.DB) return
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS shared_conversations (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        title TEXT NOT NULL,
        content_json TEXT NOT NULL,
        has_google_data INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        expires_at INTEGER NOT NULL,
        deleted_at INTEGER
      )`
    ).run()
    await env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_shared_owner ON shared_conversations(owner_email)`
    ).run()
    // Table partagée du rate-limit (aussi créée par memory-extract) — on la
    // garantit ici pour que le cap 5/j ne fail-open pas au tout premier partage.
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
    console.error('[share] ensure table failed', err)
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const email = await verifyGoogleUser(request)
  if (!email) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!env.DB) {
    return Response.json({ error: 'share_unavailable' }, { status: 503 })
  }

  let payload: SharePayload
  try {
    payload = (await request.json()) as SharePayload
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  // euOnly : refus net (promesse de confidentialité EU).
  if (payload.euOnly === true) {
    return Response.json({ error: 'share_eu_blocked' }, { status: 400 })
  }

  const rawMessages = Array.isArray(payload.messages) ? payload.messages : []
  const messages: ShareMessage[] = rawMessages
    .filter((m): m is { role: string; content: string; timestamp?: number } =>
      !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    )
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: typeof m.timestamp === 'number' ? m.timestamp : undefined,
    }))
  if (messages.length === 0) {
    return Response.json({ error: 'share_empty' }, { status: 400 })
  }

  const title = (typeof payload.title === 'string' ? payload.title : 'Conversation Arty').slice(0, MAX_TITLE_CHARS)
  const usedModels = Array.isArray(payload.usedModels)
    ? payload.usedModels.filter((x) => typeof x === 'string').slice(0, 8)
    : []
  const hasGoogleData = payload.hasGoogleData === true

  const stored = JSON.stringify({ title, messages, usedModels, createdAt: Date.now() })
  if (stored.length > MAX_PAYLOAD_CHARS) {
    return Response.json({ error: 'share_too_large' }, { status: 413 })
  }

  await ensureTable(env)
  await maybeCleanup(env, `DELETE FROM shared_conversations WHERE expires_at < unixepoch()`, [])

  // Rate limit : 5 créations / 24 h / user (compteur atomique, jour glissant
  // par clé YYYY-MM-DD — suffisant comme anti-spam).
  const day = new Date().toISOString().slice(0, 10)
  const rl = await consumeCapAtomic(
    env,
    `INSERT INTO bg_quota (email, day, task, count, updated_at)
     VALUES (?1, ?2, ?3, 1, unixepoch())
     ON CONFLICT (email, day, task) DO UPDATE SET count = count + 1, updated_at = unixepoch()
       WHERE bg_quota.count < ?4
     RETURNING count`,
    [email, day, 'share-create', DAILY_CREATE_CAP]
  )
  if (rl.status === 'cap_reached') {
    return Response.json({ error: 'share_rate_limit' }, { status: 429 })
  }

  // Max 20 partages actifs : on supprime (soft) le plus ancien si dépassement.
  try {
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM shared_conversations WHERE owner_email = ?1 AND deleted_at IS NULL AND expires_at > unixepoch()`
    ).bind(email).first<{ n: number }>()
    if ((countRow?.n ?? 0) >= MAX_ACTIVE_PER_USER) {
      await env.DB.prepare(
        `UPDATE shared_conversations SET deleted_at = unixepoch()
         WHERE id = (SELECT id FROM shared_conversations
                     WHERE owner_email = ?1 AND deleted_at IS NULL
                     ORDER BY created_at ASC LIMIT 1)`
      ).bind(email).run()
    }
  } catch (err) {
    console.error('[share] active-count check failed', err)
  }

  const id = crypto.randomUUID()
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_DAYS * 86400
  try {
    await env.DB.prepare(
      `INSERT INTO shared_conversations (id, owner_email, title, content_json, has_google_data, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(id, email, title, stored, hasGoogleData ? 1 : 0, expiresAt).run()
  } catch (err) {
    console.error('[share] insert failed', err)
    return Response.json({ error: 'share_failed' }, { status: 500 })
  }

  return Response.json({ id, expiresAt })
}
