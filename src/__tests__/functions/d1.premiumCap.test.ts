// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { makeD1Harness, type D1Harness } from './d1Harness'
import { checkPremiumCap } from '../../../functions/api/_lib/checkPremiumCap'

// Zone 1 (C8/F-5) — consumeCapAtomic via checkPremiumCap : l'upsert conditionnel
// D1 ne dépasse JAMAIS le cap, même sous appels concurrents (le pattern KV
// get→check→put, lui, le pouvait). On utilise le bucket image (cap 10) pour
// tester la concurrence à moindre coût.
const IMG = 'gpt-image-1'        // bucket 'gpt-image', cap 10
const STD = 'claude-haiku-4-5'   // standard, jamais cappé

let h: D1Harness
beforeAll(async () => { h = await makeD1Harness() })
afterAll(async () => { await h.dispose() })
beforeEach(async () => { await h.reset() })

describe('checkPremiumCap — cap atomique (zone 1)', () => {
  it('un modèle standard passe sans consommer de cap', async () => {
    const r = await checkPremiumCap('std@x.io', STD, h.env)
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe('standard_model')
    const row = await h.db.prepare('SELECT COUNT(*) AS n FROM premium_cap').first<{ n: number }>()
    expect(row!.n).toBe(0) // aucun compteur créé pour un modèle standard
  })

  it('décrémente le restant et expose bucket + cap', async () => {
    const r = await checkPremiumCap('u1@x.io', IMG, h.env)
    expect(r.allowed).toBe(true)
    expect(r.reason).toBe('monthly_cap')
    expect(r.bucket).toBe('gpt-image')
    expect(r.cap).toBe(10)
    expect(r.remaining).toBe(9)
  })

  it('consommation SÉQUENTIELLE : la garde WHERE count<cap plafonne exactement au cap', async () => {
    // Preuve DÉTERMINISTE de la garde conditionnelle (pas de fail_open possible
    // hors concurrence, D1 in-memory répond en <1ms) : cap appels consommés avec
    // un restant qui décroît, puis refus net.
    const email = 'seq@x.io'
    const cap = 10
    for (let i = 0; i < cap; i++) {
      const r = await checkPremiumCap(email, IMG, h.env)
      expect(r.allowed).toBe(true)
      expect(r.reason).toBe('monthly_cap')
      expect(r.remaining).toBe(cap - 1 - i)
    }
    const over = await checkPremiumCap(email, IMG, h.env)
    expect(over.allowed).toBe(false)
    expect(over.reason).toBe('cap_reached')
    const row = await h.db.prepare('SELECT count FROM premium_cap WHERE email=?1').bind(email).first<{ count: number }>()
    expect(row!.count).toBe(cap)
  })

  it('appels CONCURRENTS : le compteur D1 ne dépasse jamais le cap', async () => {
    // Le harnais Miniflare est mono-writer (SQLite sérialise les écritures) : ce
    // test ne prouve PAS l'atomicité sous course matérielle réelle (impossible en
    // in-memory), mais il vérifie l'invariant de NON-DÉPASSEMENT sous charge —
    // la garde `WHERE count < cap` n'est jamais franchie, même quand une part des
    // appels part en fail_open (timeout 250ms non annulable). L'assertion robuste
    // est donc `<= cap` (une écriture différée peut committer après le read).
    const email = 'race@x.io'
    const cap = 10
    const results = await Promise.all(
      Array.from({ length: cap * 3 }, () => checkPremiumCap(email, IMG, h.env)),
    )
    const row = await h.db
      .prepare('SELECT count FROM premium_cap WHERE email = ?1')
      .bind(email)
      .first<{ count: number }>()
    expect(row!.count).toBeLessThanOrEqual(cap) // JAMAIS de dépassement
    // Aucun restant négatif (overspend) sur les réponses réellement consommées.
    for (const r of results) {
      if (typeof r.remaining === 'number') expect(r.remaining).toBeGreaterThanOrEqual(0)
    }
    // Saturation atteinte : au moins un refus cap_reached.
    expect(results.some((r) => r.reason === 'cap_reached')).toBe(true)
  })
})
