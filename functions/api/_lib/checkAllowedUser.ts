import type { Env } from '../../env'

/**
 * Check if the request is allowed to use server-side API keys.
 * Verifies the Google access token and checks the email whitelist.
 * Returns the verified email if allowed, null otherwise.
 */
export async function checkAllowedUser(
  request: Request,
  env: Env
): Promise<string | null> {
  const allowedEmails = env.ALLOWED_EMAILS
  if (!allowedEmails) return null // no whitelist = no server keys for anyone

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

    // Check whitelist
    const allowed = allowedEmails
      .split(',')
      .map((e: string) => e.trim().toLowerCase())
      .filter(Boolean)

    return allowed.includes(email) ? email : null
  } catch {
    return null
  }
}
