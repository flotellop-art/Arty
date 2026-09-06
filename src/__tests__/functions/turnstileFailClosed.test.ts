import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_HOSTS,
  turnstileMisconfiguredInProd,
} from '../../../functions/api/_lib/emailTrial'
import { onRequestPost } from '../../../functions/api/auth/email/request-otp'
import { ALLOWED_ORIGINS, isAllowedOrigin } from '../../../functions/api/_middleware'
import { LEGACY_API_HOST } from '../../../functions/_middleware'
import type { Env } from '../../../functions/env'

// C2 / F-10 (fail-closed) — en PRODUCTION, une TURNSTILE_SECRET_KEY manquante
// ne doit PAS désactiver silencieusement le captcha : request-otp refuse en 503.
// Les hosts non-prod (previews `<hash>.appfacade.pages.dev`, wrangler dev sur
// localhost) restent fail-open (rate-limits D1 actifs) pour ne pas exiger la
// clé hors prod. Détection par HOST du déploiement, pas par CF_PAGES_BRANCH
// (présence au runtime des Pages Functions non documentée).

const KEYLESS = {} as unknown as Env
const WITH_KEY = { TURNSTILE_SECRET_KEY: 'sk-test' } as unknown as Env

function req(url: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'someone@example.com' }),
  })
}

describe('turnstileMisconfiguredInProd (C2/F-10)', () => {
  it.each([
    'https://tryarty.com/api/auth/email/request-otp',
    'https://appfacade.pages.dev/api/auth/email/request-otp',
  ])('PROD sans clé → misconfiguré (%s)', (url) => {
    expect(turnstileMisconfiguredInProd(KEYLESS, req(url))).toBe(true)
  })

  it.each([
    'https://abc123.appfacade.pages.dev/api/auth/email/request-otp', // preview Pages
    'http://localhost:8788/api/auth/email/request-otp', // wrangler pages dev
    'http://127.0.0.1:8788/api/auth/email/request-otp',
  ])('non-prod sans clé → PAS misconfiguré, fail-open conservé (%s)', (url) => {
    expect(turnstileMisconfiguredInProd(KEYLESS, req(url))).toBe(false)
  })

  it('prod AVEC clé → pas misconfiguré (chemin nominal)', () => {
    expect(
      turnstileMisconfiguredInProd(WITH_KEY, req('https://tryarty.com/api/auth/email/request-otp'))
    ).toBe(false)
  })

  it('host prod en casse mixte → quand même détecté (normalisation lowercase)', () => {
    expect(
      turnstileMisconfiguredInProd(KEYLESS, req('https://TryArty.com/api/auth/email/request-otp'))
    ).toBe(true)
  })
})

describe('couverture des hosts web ET API de production (anti-dérive, pattern F-1)', () => {
  // Un domaine prod ajouté au middleware mais oublié dans PRODUCTION_HOSTS
  // serait FAIL-OPEN silencieux sur le gate Turnstile — exactement le trou que
  // C2/F-10 ferme. Ce test impose la synchronisation par la CI, pas par un
  // commentaire. L'hôte API historique n'est PAS une origine web autorisée.
  // Les origins non-HTTPS (capacitor://) et localhost (Capacitor
  // on-device, wrangler dev) sont hors périmètre : ce ne sont pas des hosts
  // de déploiement prod.
  const prodOriginHosts = ALLOWED_ORIGINS.filter(
    (o) => o.startsWith('https://') && !o.includes('localhost')
  ).map((o) => new URL(o).hostname.toLowerCase())

  it('chaque host prod HTTPS du middleware est couvert par le gate Turnstile', () => {
    for (const host of prodOriginHosts) {
      expect(PRODUCTION_HOSTS.has(host), `host prod non couvert par le gate : ${host}`).toBe(true)
    }
  })

  it('couvre exactement les hosts web et le host API de transition, jamais les previews', () => {
    expect([...PRODUCTION_HOSTS].sort()).toEqual([...new Set([...prodOriginHosts, LEGACY_API_HOST])].sort())
    expect(PRODUCTION_HOSTS.has(LEGACY_API_HOST)).toBe(true)
    expect(PRODUCTION_HOSTS.has('branch.appfacade.pages.dev')).toBe(false)
  })

  it('ne confond pas hôte API de production et Origin navigateur autorisée', () => {
    expect(ALLOWED_ORIGINS).not.toContain(`https://${LEGACY_API_HOST}`)
    expect(isAllowedOrigin(`https://${LEGACY_API_HOST}`)).toBe(false)
  })
})

describe('request-otp — gate fail-closed en prod (C2/F-10)', () => {
  // Env minimal qui passe le check de config initial (DB/secret/Resend présents)
  // mais SANS clé Turnstile. Le D1 factice jette si on l'atteint : le gate doit
  // couper AVANT tout accès à la base.
  function makeEnv(withTurnstileKey: boolean): Env {
    return {
      DB: {
        prepare() {
          throw new Error('D1 ne doit pas être atteint dans ce test')
        },
      },
      EMAIL_TRIAL_SECRET: 'secret-hmac-de-test-suffisamment-long',
      RESEND_API_KEY: 're_test',
      EMAIL_FROM: 'Arty <noreply@tryarty.com>',
      ...(withTurnstileKey ? { TURNSTILE_SECRET_KEY: 'sk-test' } : {}),
    } as unknown as Env
  }

  function ctx(url: string, env: Env): Parameters<typeof onRequestPost>[0] {
    return { request: req(url), env } as unknown as Parameters<typeof onRequestPost>[0]
  }

  it.each(['tryarty.com', 'appfacade.pages.dev'])('PROD %s sans clé → 503 email_trial_unavailable, AUCUN accès D1, aucun email', async (host) => {
    const res = await onRequestPost(ctx(`https://${host}/api/auth/email/request-otp`, makeEnv(false)))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'email_trial_unavailable' })
  })

  it('preview sans clé → le gate ne coupe PAS (le flux continue au-delà, fail-open)', async () => {
    // Le D1 factice jette au premier accès (rate-limit) → catch fail-closed → 429.
    // Un 429 (et pas 503) prouve que le gate a laissé passer et que le flux a continué.
    const res = await onRequestPost(
      ctx('https://abc123.appfacade.pages.dev/api/auth/email/request-otp', makeEnv(false))
    )
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})
