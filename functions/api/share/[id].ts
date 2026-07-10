import type { Env } from '../../env'
import { verifyGoogleUserStrict } from '../_lib/checkAllowedUser'

/**
 * P1.5 — Lecture publique (GET) et révocation (DELETE) d'un partage.
 *
 * GET /api/share/:id — AUCUNE auth (c'est tout l'enjeu viral). Réponse
 * STRICTEMENT identique (404, même corps) qu'un id introuvable, expiré ou
 * révoqué — un scanner ne doit pas distinguer « jamais existé » de « supprimé »
 * (RÈGLE 6 leak). Les ids supprimés ne sont jamais réutilisés (soft delete).
 *
 * DELETE /api/share/:id — auth Google + vérification owner. Soft delete.
 */

const NOT_FOUND = () => Response.json({ error: 'Not found' }, { status: 404 })

function getId(params: Record<string, string | string[]>): string {
  const raw = params.id
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
}

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = getId(params)
  // UUID strict — évite toute injection et borne la lecture.
  if (!/^[a-f0-9-]{36}$/i.test(id) || !env.DB) return NOT_FOUND()

  try {
    const row = await env.DB.prepare(
      `SELECT title, content_json, has_google_data, created_at
         FROM shared_conversations
        WHERE id = ?1 AND deleted_at IS NULL AND expires_at > unixepoch()`
    ).bind(id).first<{ title: string; content_json: string; has_google_data: number; created_at: number }>()

    if (!row) return NOT_FOUND()

    return new Response(
      JSON.stringify({
        title: row.title,
        payload: JSON.parse(row.content_json),
        hasGoogleData: row.has_google_data === 1,
        createdAt: row.created_at,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // Lecture publique — cache court côté CDN, pas de PII tierce
          // (l'auteur a explicitement publié son propre contenu).
          'Cache-Control': 'public, max-age=300',
          'Access-Control-Allow-Origin': '*',
        },
      }
    )
  } catch (err) {
    console.error('[share] read failed', err)
    return NOT_FOUND()
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ params, request, env }) => {
  const email = await verifyGoogleUserStrict(request, env.GOOGLE_CLIENT_ID)
  if (!email) return Response.json({ error: 'Authentication required' }, { status: 401 })
  const id = getId(params)
  if (!/^[a-f0-9-]{36}$/i.test(id) || !env.DB) return NOT_FOUND()

  try {
    // Soft delete restreint au propriétaire (filtre sur l'email vérifié, jamais
    // sur une valeur du client). Réponse uniforme quelle que soit l'existence.
    await env.DB.prepare(
      `UPDATE shared_conversations SET deleted_at = unixepoch()
        WHERE id = ?1 AND owner_email = ?2 AND deleted_at IS NULL`
    ).bind(id, email).run()
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[share] delete failed', err)
    return Response.json({ error: 'delete_failed' }, { status: 500 })
  }
}
