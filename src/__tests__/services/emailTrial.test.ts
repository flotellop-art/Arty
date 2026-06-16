import { describe, it, expect } from 'vitest'
import {
  normalizeEmail,
  isValidEmail,
  isDisposableDomain,
  generateOtp,
  emailTrialKey,
  EMAIL_TRIAL_MESSAGES,
} from '../../../functions/api/_lib/emailTrial'

// Verrou de régression sur la logique anti-abus de l'essai par email (audit
// red-team Opus). normalizeEmail = clé du cap par email (HIGH-6) ; generateOtp
// = CSPRNG sans biais (CRIT-3) ; emailTrialKey = espace de clés disjoint (CRIT-1).

describe('normalizeEmail — anti-abus +alias / points (HIGH-6)', () => {
  it('lowercase + strip de l\'alias +tag pour tous les providers', () => {
    expect(normalizeEmail('Me+Promo@Example.com')).toBe('me@example.com')
    expect(normalizeEmail('john+a+b@company.io')).toBe('john@company.io')
  })

  it('Gmail : strip des points ET de l\'alias, googlemail → gmail', () => {
    expect(normalizeEmail('j.o.h.n@gmail.com')).toBe('john@gmail.com')
    expect(normalizeEmail('john.doe+spam@gmail.com')).toBe('johndoe@gmail.com')
    expect(normalizeEmail('John.Doe@googlemail.com')).toBe('johndoe@gmail.com')
  })

  it('ne touche PAS aux points hors Gmail (significatifs ailleurs)', () => {
    expect(normalizeEmail('john.doe@outlook.com')).toBe('john.doe@outlook.com')
  })

  it('toutes les variantes Gmail d\'un même humain collisionnent sur une seule clé', () => {
    const canonical = normalizeEmail('alice@gmail.com')
    expect(normalizeEmail('a.l.i.c.e@gmail.com')).toBe(canonical)
    expect(normalizeEmail('alice+test1@gmail.com')).toBe(canonical)
    expect(normalizeEmail('ALICE+x@GMAIL.COM')).toBe(canonical)
  })
})

describe('isValidEmail', () => {
  it('accepte des emails bien formés', () => {
    expect(isValidEmail('a@b.co')).toBe(true)
    expect(isValidEmail('john.doe@example.com')).toBe(true)
  })
  it('rejette les malformés / trop longs / non-string', () => {
    expect(isValidEmail('nope')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('a @b.co')).toBe(false)
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail(`${'a'.repeat(250)}@b.co`)).toBe(false)
    // @ts-expect-error test runtime guard
    expect(isValidEmail(null)).toBe(false)
  })
})

describe('isDisposableDomain', () => {
  it('bloque les domaines jetables connus', () => {
    expect(isDisposableDomain('x@mailinator.com')).toBe(true)
    expect(isDisposableDomain('x@yopmail.com')).toBe(true)
  })
  it('laisse passer les domaines normaux', () => {
    expect(isDisposableDomain('x@gmail.com')).toBe(false)
    expect(isDisposableDomain('x@company.fr')).toBe(false)
  })
})

describe('generateOtp — CSPRNG, format, pas de biais (CRIT-3)', () => {
  it('renvoie toujours 6 chiffres', () => {
    for (let i = 0; i < 2000; i++) {
      const otp = generateOtp()
      expect(otp).toMatch(/^\d{6}$/)
    }
  })
  it('couvre le bord bas (codes à zéros de tête possibles via padding)', () => {
    // Tirage statistique : sur 5000 codes, on doit voir un éventail large
    // (sanity check non déterministe mais ultra-probable).
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) seen.add(generateOtp())
    expect(seen.size).toBeGreaterThan(4000) // quasi pas de collisions → bonne entropie
  })
})

describe('emailTrialKey — espace de clés disjoint (CRIT-1)', () => {
  it('préfixe l\'identité downstream pour ne jamais collisionner avec un email Google brut', () => {
    expect(emailTrialKey('alice@gmail.com')).toBe('trial-email:alice@gmail.com')
    expect(emailTrialKey('alice@gmail.com')).not.toBe('alice@gmail.com')
  })
})

describe('EMAIL_TRIAL_MESSAGES', () => {
  it('miroir du cap trial Google (30)', () => {
    expect(EMAIL_TRIAL_MESSAGES).toBe(30)
  })
})
