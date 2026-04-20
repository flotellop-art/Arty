import type { Env } from '../../env'

/**
 * Vérifie le token Google passé dans le header `x-google-token` auprès
 * de l'API userinfo de Google. Retourne l'email vérifié (en minuscules)
 * si le token est valide, null sinon.
 *
 * Usage : gate d'authentification pour les endpoints qui acceptent tout
 * utilisateur Google (BYOK inclus). Empêche le relais anonyme via un
 * header forgé — Google est la source de vérité.
 */
export async function verifyGoogleUser(
  request: Request
): Promise<string | null> {
  const googleToken = request.headers.get('x-google-token')
  if (!googleToken) return null

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })
    if (!res.ok) return null
    const userInfo = (await res.json()) as { email?: string }
    return userInfo.email?.toLowerCase() ?? null
  } catch {
    return null
  }
}

/**
 * Vérifie si l'utilisateur est autorisé à utiliser les clés API côté
 * serveur (payées par le propriétaire de l'app). Retourne l'email
 * vérifié si whitelisté, null sinon.
 *
 * Deux niveaux de garde :
 * 1. `ALLOWED_EMAILS` doit être set dans l'env Cloudflare. Si absent,
 *    personne n'accède aux clés serveur (échec fermé).
 * 2. Le token Google est vérifié auprès de Google (via `verifyGoogleUser`),
 *    puis l'email est comparé à la liste blanche.
 *
 * Usage : gate pour les proxies IA qui tombent sur la clé serveur en
 * l'absence de BYOK. Les utilisateurs en BYOK n'ont pas besoin d'être
 * whitelistés — ils payent leurs propres appels.
 */
export async function checkAllowedUser(
  request: Request,
  env: Env
): Promise<string | null> {
  const allowedEmails = env.ALLOWED_EMAILS
  if (!allowedEmails) return null // no whitelist = no server keys for anyone

  const email = await verifyGoogleUser(request)
  if (!email) return null

  const allowed = allowedEmails
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(email) ? email : null
}
