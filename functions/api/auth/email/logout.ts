import type { Env } from '../../../env'
import { revokeSession } from '../../_lib/emailTrial'

/**
 * POST /api/auth/email/logout — body { token }
 *
 * Révoque (supprime) la session email-trial côté serveur. Hygiène BUG 41 :
 * le client supprime aussi le jeton de son localStorage. Posséder le jeton
 * suffit à le révoquer (c'est lui-même le secret) ; Origin-gated par le
 * middleware. Toujours 200 (best-effort, idempotent, pas d'oracle).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as { token?: unknown }
    if (typeof body.token === 'string' && body.token) {
      await revokeSession(env, body.token)
    }
  } catch {
    /* best-effort */
  }
  return Response.json({ ok: true })
}
