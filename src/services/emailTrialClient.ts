/**
 * Client de l'essai par email (OTP) — identité sans Google ni carte bancaire.
 *
 * Le jeton de session est OPAQUE (256 bits, généré serveur, stocké HASHÉ en D1
 * et révocable). Côté client il vit dans le scopedStorage de la session active
 * (`arty-<userId>-email-trial-token`) : lecture synchrone au boot (le jeton
 * établit la session, donc avant initCrypto — pas de chiffrement at-rest, même
 * posture que les comptes Google sans BYOK, cf. note sécu CLAUDE.md). Comme il
 * est scopé par userId, switcher vers un compte Google ne fait JAMAIS fuiter le
 * jeton d'essai (lecture sous l'autre préfixe → null).
 */
import { apiUrl } from './apiBase'
import * as scoped from './scopedStorage'

const TOKEN_KEY = 'email-trial-token'

export class EmailTrialError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
    this.name = 'EmailTrialError'
  }
}

export function getTrialToken(): string | null {
  return scoped.getItem(TOKEN_KEY)
}

export function setTrialToken(token: string): void {
  scoped.setItem(TOKEN_KEY, token)
  // C-E / F-1 (CDC visibilité modèle, décision D2) — un compte essai email n'a
  // PAS de token Google : usePlanStatus ne peut jamais appeler
  // /api/subscription/status, donc 'arty-plan-cache' restait null pour
  // toujours → selectClaudeSubModel demandait Sonnet → le proxy substituait
  // Haiku EN SILENCE à chaque message (l'UI affichait Sonnet, mensonge
  // permanent). On pose ici la MÊME valeur que le serveur aurait renvoyée
  // (normalizePlan mappe 'trial' → 'free', subscription/status.ts) : le
  // client demande directement Haiku, le swap serveur devient un filet
  // jamais déclenché. Clé GLOBALE volontairement (même convention que
  // usePlanStatus.ts:89).
  try { localStorage.setItem('arty-plan-cache', 'free') } catch { /* noop */ }
}

/**
 * Supprime le jeton d'essai (logout) et le révoque côté serveur (best-effort,
 * BUG 41). DOIT être appelé pendant que la session est encore active (le
 * scopedStorage résout le préfixe via la session courante).
 */
export function clearTrialToken(): void {
  const token = scoped.getItem(TOKEN_KEY)
  scoped.removeItem(TOKEN_KEY)
  if (token) {
    fetch(apiUrl('/api/auth/email/logout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => {})
  }
}

async function errorCode(res: Response): Promise<string> {
  try {
    const d = (await res.json()) as { error?: string }
    return d.error || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Demande l'envoi d'un code OTP par email. Throw EmailTrialError(code) en cas d'échec. */
export async function requestOtp(email: string, turnstileToken?: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(apiUrl('/api/auth/email/request-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken }),
    })
  } catch {
    throw new EmailTrialError('network')
  }
  // BUG 4 — vérifier res.ok AVANT de parser.
  if (!res.ok) throw new EmailTrialError(await errorCode(res))
}

/** Vérifie le code OTP. Retourne { token, email }. Throw EmailTrialError(code) sinon. */
export async function verifyOtp(
  email: string,
  code: string
): Promise<{ token: string; email: string }> {
  let res: Response
  try {
    res = await fetch(apiUrl('/api/auth/email/verify-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
  } catch {
    throw new EmailTrialError('network')
  }
  if (!res.ok) throw new EmailTrialError(await errorCode(res))
  return (await res.json()) as { token: string; email: string }
}
