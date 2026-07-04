// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import {
  storeOtp,
  verifyOtp,
  checkRequestOtpRateLimit,
} from '../../../functions/api/_lib/emailTrial'
import type { Env } from '../../../functions/env'

// Zone 2 (C8/F-5) — flux OTP email-trial : single-use (DELETE…RETURNING),
// plafond de tentatives, et rate-limits FAIL-CLOSED.
let h: D1Harness
beforeAll(async () => { h = await makeD1Harness({ EMAIL_TRIAL_SECRET: 'unit-secret' } as Partial<Env>) })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset() })

describe('OTP — single-use & tentatives (zone 2)', () => {
  it('un code valide ne marche QU’UNE fois (DELETE…RETURNING)', async () => {
    const email = 'otp1@x.io'
    const code = await storeOtp(h.env, email)
    expect(code).toMatch(/^\d{6}$/)
    expect(await verifyOtp(h.env, email, code!)).toBe(true)
    // preuve d'état : la ligne a été PHYSIQUEMENT supprimée (DELETE…RETURNING),
    // pas juste un booléen retourné.
    const gone = await h.db.prepare('SELECT COUNT(*) AS n FROM email_otp WHERE email=?1').bind(email).first<{ n: number }>()
    expect(gone!.n).toBe(0)
    // rejoué : refus (pas de double-spend)
    expect(await verifyOtp(h.env, email, code!)).toBe(false)
  })

  it('après 5 tentatives erronées, même le bon code est refusé', async () => {
    const email = 'otp2@x.io'
    const code = await storeOtp(h.env, email)
    for (let i = 0; i < 5; i++) {
      expect(await verifyOtp(h.env, email, 'badcode')).toBe(false)
    }
    // attempts = 5 → la garde `attempts < 5` bloque même le vrai code
    expect(await verifyOtp(h.env, email, code!)).toBe(false)
    const row = await h.db.prepare('SELECT attempts FROM email_otp WHERE email=?1').bind(email).first<{ attempts: number }>()
    expect(row!.attempts).toBeGreaterThanOrEqual(5)
  })

  it('un mauvais code n’invalide pas immédiatement (le bon passe encore au 1er essai)', async () => {
    const email = 'otp3@x.io'
    const code = await storeOtp(h.env, email)
    expect(await verifyOtp(h.env, email, 'nope00')).toBe(false)
    expect(await verifyOtp(h.env, email, code!)).toBe(true)
  })
})

describe('OTP — rate-limits fail-closed (zone 2)', () => {
  it('plafonne l’envoi à 5 par email/jour', async () => {
    const email = 'rl@x.io'
    const ip = '10.0.0.1'
    const outcomes: boolean[] = []
    for (let i = 0; i < 6; i++) outcomes.push(await checkRequestOtpRateLimit(h.env, email, ip))
    expect(outcomes.filter(Boolean).length).toBe(5) // 5 autorisés
    expect(outcomes[5]).toBe(false)                 // 6e bloqué
  })

  it('FAIL-CLOSED sans binding D1 (refuse au lieu de laisser passer)', async () => {
    const noDb = { EMAIL_TRIAL_SECRET: 'unit-secret' } as unknown as Env // pas de DB
    expect(await checkRequestOtpRateLimit(noDb, 'x@y.z', '10.0.0.2')).toBe(false)
  })
})
