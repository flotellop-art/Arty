import type { Env } from '../../env'
import { consumeCapAtomic } from './atomicQuota'
import {
  verifyGoogleUser,
  type AllowedUser,
  type CheckResult,
  TRIAL_ALLOWED_MODELS,
} from './checkAllowedUser'

// ─────────────────────────────────────────────────────────────────────
// Essai par email (OTP) — identité sans Google ni carte bancaire.
//
// Modèle de menace (audit red-team Opus, RÈGLE 7) :
//   - CRIT-1 collision d'identité : l'email vérifié-OTP NE DOIT JAMAIS partager
//     la clé primaire d'un compte Google (memory / subscriptions / trial_usage).
//     → espace de clés PHYSIQUEMENT disjoint : table `email_trial_usage` dédiée,
//       et identité downstream préfixée `trial-email:<email>` (jamais l'email
//       brut dans les tables partagées comme quota_model). Plan figé `trial`,
//       JAMAIS de resolveUserPlan ni de bypass ALLOWED_EMAILS.
//   - CRIT-2 hash OTP : HMAC(secret, email‖code), jamais SHA-256(code) nu
//     (un dump D1 d'un hash nu = rainbow table de 10^6 préimages crackée en ms).
//   - CRIT-3 génération : crypto.getRandomValues + rejection sampling, jamais
//     Math.random (PRNG V8 prédictible).
//   - HIGH-3 atomicité : vérif = un seul statement DELETE…RETURNING (single-use,
//     pas de double-spend ni d'incrément perdu sur requêtes concurrentes).
//   - HIGH-1/2/5 abus : rate-limit D1 FAIL-CLOSED (pas le Map in-memory par
//     isolat) par email ET par IP, + Turnstile optionnel sur l'envoi.
//   - HIGH-6 emails jetables / +alias : normalisation Gmail + blacklist.
// ─────────────────────────────────────────────────────────────────────

/** Cap de messages d'essai email — miroir du trial Google (30). */
export const EMAIL_TRIAL_MESSAGES = 30

/** Durée de vie de l'OTP (10 min). */
const OTP_TTL_SECONDS = 600
/** Tentatives de vérification autorisées par code avant invalidation. */
const OTP_MAX_ATTEMPTS = 5
/** Durée de vie du jeton de session (30 j) — révocable (suppression de ligne D1). */
const SESSION_TTL_SECONDS = 30 * 24 * 3600

// Plafonds de rate-limit (fail-closed). Bornent le brute-force ET l'email-bombing.
//   email/jour = 5 envois max (un attaquant ne peut pas inonder un tiers).
//   IP/heure (request) = 10 envois max depuis une IP.
//   IP/heure (verify)  = 30 essais max depuis une IP (anti « 1 code, N comptes »).
const OTP_REQ_PER_EMAIL_DAY = 5
const OTP_REQ_PER_IP_HOUR = 10
const OTP_VERIFY_PER_IP_HOUR = 30

/** Préfixe d'identité disjoint pour tout usage downstream (recordUsage, logs). */
export function emailTrialKey(normalizedEmail: string): string {
  return `trial-email:${normalizedEmail}`
}

// ── Validation / normalisation d'email ──────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(raw: string): boolean {
  if (typeof raw !== 'string') return false
  const e = raw.trim()
  return e.length <= 254 && EMAIL_RE.test(e)
}

// Domaines jetables courants — best-effort (impossible d'être exhaustif).
// Bloque le contournement le plus trivial du cap (1 adresse jetable = 1 essai).
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com',
  'yopmail.com', 'yopmail.fr', '10minutemail.com', 'temp-mail.org', 'tempmail.com',
  'trashmail.com', 'getnada.com', 'maildrop.cc', 'dispostable.com', 'mailnesia.com',
  'fakeinbox.com', 'throwawaymail.com', 'mohmal.com', 'tempmailo.com', 'emailondeck.com',
  'mailcatch.com', 'spamgourmet.com', 'mintemail.com', 'tmpmail.org', 'mvrht.net',
])

export function isDisposableDomain(normalizedEmail: string): boolean {
  const at = normalizedEmail.lastIndexOf('@')
  if (at < 0) return false
  return DISPOSABLE_DOMAINS.has(normalizedEmail.slice(at + 1))
}

/**
 * Normalise un email pour la clé d'essai (anti-abus HIGH-6).
 *   - minuscules (cohérent avec le lowercasing email partout dans le code)
 *   - strip de l'alias `+tag` (largement supporté par les providers)
 *   - Gmail/Googlemail : strip aussi des points du local-part + alias domain
 * Direction de sécurité : agressif. Pire cas = deux adresses `+` distinctes
 * légitimes partagent un essai (impact mineur) ; bénéfice = pas d'essais infinis
 * via `me+1@`, `me+2@`, `m.e@gmail`.
 */
export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  let local = email.slice(0, at)
  let domain = email.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  // alias +tag : retiré pour tous les providers
  const plus = local.indexOf('+')
  if (plus >= 0) local = local.slice(0, plus)
  // Gmail ignore les points dans le local-part
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return `${local}@${domain}`
}

// ── Helpers crypto (Workers : crypto.subtle / getRandomValues natifs) ────

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return toHex(buf)
}

/** CRIT-2 : HMAC-SHA256(secret, message) en hex — keyed-hash, pas de hash nu. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toHex(sig)
}

/** CRIT-3 : code 6 chiffres uniforme via CSPRNG + rejection sampling (pas de biais modulo). */
export function generateOtp(): string {
  const MAX = 1_000_000
  // Plus grand multiple de MAX sous 2^32 → on rejette au-dessus pour un tirage uniforme.
  const limit = Math.floor(0xffffffff / MAX) * MAX
  const buf = new Uint32Array(1)
  let n: number
  do {
    crypto.getRandomValues(buf)
    n = buf[0]
  } while (n >= limit)
  return String(n % MAX).padStart(6, '0')
}

/** Jeton de session opaque 256 bits (base64url). Stocké HASHÉ en D1 (cf. createSession). */
function generateSessionTokenRaw(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return toBase64Url(buf)
}

// ── Tables D1 ────────────────────────────────────────────────────────────

let tablesEnsured = false
export async function ensureEmailTrialTables(env: Env): Promise<void> {
  if (!env.DB || tablesEnsured) return
  try {
    await env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS email_otp (
          email TEXT PRIMARY KEY,
          code_hash TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )`
      ),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS email_trial_sessions (
          token_hash TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          last_used_at INTEGER
        )`
      ),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS email_trial_usage (
          email TEXT PRIMARY KEY,
          used INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL
        )`
      ),
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS otp_rate (
          bucket TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER NOT NULL
        )`
      ),
    ])
    tablesEnsured = true
  } catch (err) {
    console.error('[emailTrial] ensure tables failed', err)
  }
}

// ── Rate-limit FAIL-CLOSED (HIGH-5) ──────────────────────────────────────
//
// Contrairement à consumeCapAtomic (fail-OPEN, adapté au quota IA cheap), un
// endpoint qui ENVOIE des emails facturables et débloque une clé IA payante
// doit fail-CLOSED : un incident D1 ne doit pas devenir un bypass illimité.
// La fenêtre est encodée DANS la clé de bucket (`<name>:<id>:<window>`) → un
// nouveau créneau = nouvelle clé = compteur à 0, pas besoin de WHERE temporel.

const RATE_TIMEOUT_MS = 400

/** @returns true si autorisé (sous le cap), false si bloqué OU incident D1 (fail-closed). */
async function consumeRateLimit(
  env: Env,
  bucket: string,
  cap: number,
  windowSeconds: number
): Promise<boolean> {
  if (!env.DB) return false // pas de D1 → on refuse (fail-closed)
  try {
    const expiresAt = Math.floor(Date.now() / 1000) + windowSeconds
    const query = env.DB.prepare(
      `INSERT INTO otp_rate (bucket, count, expires_at)
       VALUES (?1, 1, ?3)
       ON CONFLICT (bucket) DO UPDATE SET count = count + 1
         WHERE otp_rate.count < ?2
       RETURNING count`
    )
      .bind(bucket, cap, expiresAt)
      .first<{ count: number }>()
    const timeout = new Promise<'__t__'>((r) => setTimeout(() => r('__t__'), RATE_TIMEOUT_MS))
    const res = await Promise.race([query, timeout])
    if (res === '__t__') {
      console.error('[emailTrial] rate-limit D1 timeout → fail-closed', bucket.split(':')[0])
      return false
    }
    // row null = cap atteint (UPDATE skip) → bloqué.
    return res !== null
  } catch (err) {
    console.error('[emailTrial] rate-limit D1 error → fail-closed', err)
    return false
  }
}

function dayWindow(): number {
  return Math.floor(Date.now() / 1000 / 86400)
}
function hourWindow(): number {
  return Math.floor(Date.now() / 1000 / 3600)
}

/** Vérifie les plafonds d'envoi (request-otp). @returns true si autorisé. */
export async function checkRequestOtpRateLimit(
  env: Env,
  normalizedEmail: string,
  ip: string
): Promise<boolean> {
  const okEmail = await consumeRateLimit(
    env,
    `er:${normalizedEmail}:${dayWindow()}`,
    OTP_REQ_PER_EMAIL_DAY,
    86400
  )
  if (!okEmail) return false
  return consumeRateLimit(env, `ir:${ip}:${hourWindow()}`, OTP_REQ_PER_IP_HOUR, 3600)
}

/** Vérifie le plafond de tentatives de vérif par IP (verify-otp, anti « 1 code N comptes »). */
export async function checkVerifyOtpRateLimit(env: Env, ip: string): Promise<boolean> {
  return consumeRateLimit(env, `iv:${ip}:${hourWindow()}`, OTP_VERIFY_PER_IP_HOUR, 3600)
}

// ── Turnstile (optionnel — enforced si TURNSTILE_SECRET_KEY est configuré) ─

/**
 * Vérifie un token Cloudflare Turnstile. Si `TURNSTILE_SECRET_KEY` n'est pas
 * configuré, retourne true (la défense repose alors sur les rate-limits D1).
 * Recommandé en prod : configurer la clé pour bloquer les bots sur l'envoi.
 */
export async function verifyTurnstile(
  env: Env,
  token: string | null,
  ip: string
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true // non configuré → skip (rate-limits actifs)
  if (!token) return false
  try {
    const form = new FormData()
    form.append('secret', env.TURNSTILE_SECRET_KEY)
    form.append('response', token)
    if (ip && ip !== 'unknown') form.append('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

// ── Envoi de l'email (Resend) ─────────────────────────────────────────────

/** Envoie le code OTP via Resend. @returns true si accepté par Resend. */
export async function sendOtpEmail(env: Env, toEmail: string, code: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    console.error('[emailTrial] RESEND_API_KEY / EMAIL_FROM manquant')
    return false
  }
  const subject = `Arty — code de connexion : ${code}`
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;padding:24px;color:#111">
    <div style="max-width:440px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #eee">
      <h1 style="font-size:18px;margin:0 0 8px">Ton code Arty</h1>
      <p style="margin:0 0 18px;color:#555;font-size:14px">Entre ce code dans l'application pour démarrer ton essai. Il expire dans 10&nbsp;minutes.<br><span style="color:#888">Enter this code in the app to start your trial. It expires in 10&nbsp;minutes.</span></p>
      <div style="font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;background:#f2f3f5;border-radius:10px;padding:16px 0">${code}</div>
      <p style="margin:18px 0 0;color:#999;font-size:12px">Tu n'as pas demandé ce code ? Ignore cet email.<br>Didn't request this? You can safely ignore this email.</p>
    </div></body></html>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: toEmail, subject, html }),
    })
    if (!res.ok) {
      console.error('[emailTrial] Resend rejected', res.status)
      return false
    }
    return true
  } catch (err) {
    console.error('[emailTrial] Resend fetch failed', err)
    return false
  }
}

// ── Stockage / vérification de l'OTP ──────────────────────────────────────

/** Génère un OTP, le stocke (HMAC, upsert qui invalide le précédent), et le retourne en clair pour l'envoi. */
export async function storeOtp(env: Env, normalizedEmail: string): Promise<string | null> {
  if (!env.DB || !env.EMAIL_TRIAL_SECRET) return null
  await ensureEmailTrialTables(env)
  const code = generateOtp()
  const codeHash = await hmacHex(env.EMAIL_TRIAL_SECRET, `${normalizedEmail}:${code}`)
  const now = Math.floor(Date.now() / 1000)
  try {
    await env.DB.prepare(
      `INSERT INTO email_otp (email, code_hash, expires_at, attempts, created_at)
       VALUES (?1, ?2, ?3, 0, ?4)
       ON CONFLICT (email) DO UPDATE SET code_hash = ?2, expires_at = ?3, attempts = 0, created_at = ?4`
    )
      .bind(normalizedEmail, codeHash, now + OTP_TTL_SECONDS, now)
      .run()
    return code
  } catch (err) {
    console.error('[emailTrial] storeOtp failed', err)
    return null
  }
}

/**
 * Vérifie l'OTP de façon ATOMIQUE (HIGH-3) : un seul DELETE…RETURNING. Succès =
 * ligne renvoyée (et déjà supprimée → single-use, pas de double-spend). Échec =
 * incrément best-effort du compteur de tentatives. @returns true si valide.
 */
export async function verifyOtp(env: Env, normalizedEmail: string, code: string): Promise<boolean> {
  if (!env.DB || !env.EMAIL_TRIAL_SECRET) return false
  await ensureEmailTrialTables(env)
  const codeHash = await hmacHex(env.EMAIL_TRIAL_SECRET, `${normalizedEmail}:${code}`)
  try {
    const row = await env.DB.prepare(
      `DELETE FROM email_otp
       WHERE email = ?1 AND code_hash = ?2 AND expires_at > unixepoch() AND attempts < ?3
       RETURNING email`
    )
      .bind(normalizedEmail, codeHash, OTP_MAX_ATTEMPTS)
      .first<{ email: string }>()
    if (row) return true
    // Échec : incrémente les tentatives (no-op si la ligne a été consommée en concurrence).
    await env.DB.prepare(
      `UPDATE email_otp SET attempts = attempts + 1 WHERE email = ?1`
    )
      .bind(normalizedEmail)
      .run()
    return false
  } catch (err) {
    console.error('[emailTrial] verifyOtp failed', err)
    return false
  }
}

/** Crée une session email-trial : stocke le HASH du jeton en D1, retourne le jeton brut. */
export async function createSession(env: Env, normalizedEmail: string): Promise<string | null> {
  if (!env.DB) return null
  await ensureEmailTrialTables(env)
  const token = generateSessionTokenRaw()
  const tokenHash = await sha256Hex(token)
  const now = Math.floor(Date.now() / 1000)
  try {
    await env.DB.prepare(
      `INSERT INTO email_trial_sessions (token_hash, email, created_at, expires_at, last_used_at)
       VALUES (?1, ?2, ?3, ?4, ?3)`
    )
      .bind(tokenHash, normalizedEmail, now, now + SESSION_TTL_SECONDS)
      .run()
    return token
  } catch (err) {
    console.error('[emailTrial] createSession failed', err)
    return null
  }
}

/**
 * Vérifie le jeton de session email-trial (header `x-arty-trial-token`).
 * Lookup par HASH (un dump D1 ne donne pas de jetons réutilisables). @returns
 * l'email NORMALISÉ porté par la session, ou null. Ne valide PAS de plan : le
 * plan est figé `trial` par construction (CRIT-1).
 */
export async function verifyEmailTrialToken(request: Request, env: Env): Promise<string | null> {
  if (!env.DB) return null
  const token = request.headers.get('x-arty-trial-token')
  if (!token) return null
  try {
    const tokenHash = await sha256Hex(token)
    const row = await env.DB.prepare(
      `SELECT email FROM email_trial_sessions
       WHERE token_hash = ?1 AND expires_at > unixepoch()
       LIMIT 1`
    )
      .bind(tokenHash)
      .first<{ email: string }>()
    return row?.email ?? null
  } catch (err) {
    console.error('[emailTrial] verifyEmailTrialToken failed', err)
    return null
  }
}

/** Révoque une session email-trial (logout). Best-effort. */
export async function revokeSession(env: Env, token: string): Promise<void> {
  if (!env.DB || !token) return
  try {
    const tokenHash = await sha256Hex(token)
    await env.DB.prepare(`DELETE FROM email_trial_sessions WHERE token_hash = ?1`)
      .bind(tokenHash)
      .run()
  } catch (err) {
    console.error('[emailTrial] revokeSession failed', err)
  }
}

// ── Consommation d'un message d'essai (espace de clés DISJOINT, CRIT-1) ────

/**
 * Décrémente le compteur d'essai email dans la table DÉDIÉE `email_trial_usage`
 * (jamais `trial_usage` qui appartient aux comptes Google). Plan TOUJOURS figé
 * `trial` — aucun resolveUserPlan, aucun bypass ALLOWED_EMAILS. C'est le cœur
 * du fix CRIT-1 : un OTP ne peut JAMAIS hériter d'un plan premium ni de données
 * d'un compte Google du même email.
 */
export async function consumeEmailTrialMessage(
  env: Env,
  normalizedEmail: string
): Promise<CheckResult> {
  const key = emailTrialKey(normalizedEmail)
  if (!env.DB) {
    return { email: key, planType: 'trial', trialRemaining: EMAIL_TRIAL_MESSAGES, allowedModels: [...TRIAL_ALLOWED_MODELS] }
  }
  await ensureEmailTrialTables(env)
  const outcome = await consumeCapAtomic(
    env,
    `INSERT INTO email_trial_usage (email, used, updated_at)
     VALUES (?1, 1, unixepoch())
     ON CONFLICT (email) DO UPDATE SET used = used + 1, updated_at = unixepoch()
       WHERE email_trial_usage.used < ?2
     RETURNING used AS count`,
    [normalizedEmail, EMAIL_TRIAL_MESSAGES]
  )
  if (outcome.status === 'cap_reached') {
    return { error: 'trial_expired', email: key }
  }
  if (outcome.status === 'fail_open') {
    return { email: key, planType: 'trial', trialRemaining: 1, allowedModels: [...TRIAL_ALLOWED_MODELS] }
  }
  return {
    email: key,
    planType: 'trial',
    trialRemaining: Math.max(0, EMAIL_TRIAL_MESSAGES - outcome.count),
    allowedModels: [...TRIAL_ALLOWED_MODELS],
  }
}

// ── Résolution d'identité unifiée pour les proxys IA ───────────────────────

export type ProxyIdentity =
  | { kind: 'google'; email: string }
  | { kind: 'email-trial'; email: string /* normalisé */ }

/**
 * Gate d'identité des proxys IA : Google D'ABORD (toujours prioritaire), puis
 * fallback email-trial. Ne broaden PAS `verifyGoogleUser` — la mémoire et les
 * endpoints Google restent Google-only (l'email-trial n'a pas de token Google).
 * Si les deux headers sont envoyés, Google gagne.
 */
export async function resolveProxyIdentity(
  request: Request,
  env: Env
): Promise<ProxyIdentity | null> {
  // Passe GOOGLE_CLIENT_ID → valide l'audience du token (fix N-1 `aud`, aligné
  // sur les proxys depuis le merge main). Le chemin Google de l'essai email
  // hérite ainsi du même durcissement que le gate principal.
  const googleEmail = await verifyGoogleUser(request, env.GOOGLE_CLIENT_ID)
  if (googleEmail) return { kind: 'google', email: googleEmail }
  const trialEmail = await verifyEmailTrialToken(request, env)
  if (trialEmail) return { kind: 'email-trial', email: trialEmail }
  return null
}

/** Pour les peeks/auxiliaires : retourne un AllowedUser email-trial sans décrémenter. */
export function emailTrialPeek(normalizedEmail: string): AllowedUser {
  return { email: emailTrialKey(normalizedEmail), planType: 'trial', allowedModels: [...TRIAL_ALLOWED_MODELS] }
}
