import type { Env } from '../../env'

/**
 * Check if the request is allowed to use server-side API keys.
 * Verifies the Google access token and checks the email whitelist.
 * Returns the verified email if allowed, null otherwise.
 *
 * ⚠️ WHITELIST DÉSACTIVÉE POUR LA BÊTA OUVERTE ⚠️
 * Tout utilisateur authentifié via Google peut désormais utiliser les clés
 * serveur, indépendamment de la variable `ALLOWED_EMAILS`. La variable est
 * préservée dans l'environnement Cloudflare et dans env.d.ts pour pouvoir
 * réactiver la whitelist facilement — il suffit de décommenter le bloc
 * ci-dessous et la ligne `if (!allowedEmails) return null`.
 */
export async function checkAllowedUser(
  request: Request,
  env: Env
): Promise<string | null> {
  // --- Whitelist désactivée (bêta ouverte) ---
  // const allowedEmails = env.ALLOWED_EMAILS
  // if (!allowedEmails) return null // no whitelist = no server keys for anyone
  void env // silence "unused env" pendant la désactivation

  // Get the Google access token from the x-google-token header
  const googleToken = request.headers.get('x-google-token')
  if (!googleToken) return null

  try {
    // Verify the token with Google's userinfo API
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })

    if (!res.ok) return null

    const userInfo = await res.json() as { email?: string }
    const email = userInfo.email?.toLowerCase()
    if (!email) return null

    // --- Whitelist désactivée (bêta ouverte) ---
    // Tout Google account valide → accès aux clés serveur.
    // Pour réactiver : remettre le bloc ci-dessous et la ligne `allowedEmails`
    // en haut de la fonction.
    //
    // const allowed = allowedEmails
    //   .split(',')
    //   .map((e: string) => e.trim().toLowerCase())
    //   .filter(Boolean)
    // return allowed.includes(email) ? email : null

    return email
  } catch {
    return null
  }
}
