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
 * Parse la valeur brute de `ALLOWED_EMAILS` en liste d'emails normalisés.
 * Tolère plusieurs formats courants qu'on rencontre quand la variable est
 * saisie à la main dans l'UI Cloudflare : virgules, points-virgules, sauts
 * de ligne, espaces, et guillemets d'enveloppe ("foo@bar.com").
 */
export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,;\s\n]+/)
    .map((e) => e.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase())
    .filter(Boolean)
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
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS)
  if (allowed.length === 0) return null // no whitelist = no server keys for anyone

  const email = await verifyGoogleUser(request)
  if (!email) return null

  return allowed.includes(email) ? email : null
}
